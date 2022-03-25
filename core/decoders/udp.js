/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * (c) 2012 Michael Tinglof, Joe Balaz, Les Piech (Mercuri.ca)
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';
import Base64 from "../base64.js";
import Inflator from "../inflator.js";

export default class UDPDecoder {
    constructor() {
        this._filter = null;
        this._numColors = 0;
        this._palette = new Uint8Array(1024);  // 256 * 4 (max palette size * max bytes-per-pixel)

        this._zlibs = [];
        for (let i = 0; i < 4; i++) {
            this._zlibs[i] = new Inflator();
        }
    }

    decodeRect(x, y, width, height, data, display, depth) {
        let ctl = data[12] >> 4;
        let ret;

        if (ctl === 0x08) {
            //Log.Debug("Fill Rect");
            ret = this._fillRect(x, y, width, height,
                data, display, depth);
        } else if (ctl === 0x09) {
            //Log.Debug("JPEG Rect");
            ret = this._jpegRect(x, y, width, height,
                data, display, depth);
        } else if (ctl === 0x0A) {
            //Log.Debug("Png Rect");
            ret = this._pngRect(x, y, width, height,
                data, display, depth);
        } else if ((ctl & 0x08) == 0) {
            //Log.Debug("Basic Rect");
            ret = this._basicRect(ctl, x, y, width, height,
                data, display, depth);
        } else if (ctl === 0x0B) {
            //Log.Debug("Webp Rect");
            ret = this._webpRect(x, y, width, height,
                data, display, depth);
        } else {
            throw new Error("Illegal udp compression received (ctl: " +
                ctl + ")");
        }
        if (!ret) {
            Log.Debug("Bad Rect");
        }

        return ret;
    }

    _fillRect(x, y, width, height, data, display, depth) {

        display.fillRect(x, y, width, height,
            [data[13], data[14], data[15]], false);

        return true;
    }

    _jpegRect(x, y, width, height, data, display, depth) {
        let img = this._readData(data);
        if (img === null) { // || !this._validateJPEG(img)) {
            return false;
        }
        //some of our jpegs are missing a byte
        if (img[img.length - 2] !== 255 && img[img.length -1] == 255) {
            //let img2 = new Uint8Array(new ArrayBuffer(img.length + 1));
            //img2.set(img);
            //img2[img2.length - 1] = 217;
            Log.Debug('JPEG is corrupt');
            return false;
            //return this._imageRect(x, y, width, height, "image/jpeg", img2, display);

        }

        display.imageRect(x, y, width, height, "image/jpeg", img);
        return true;
        //return this._imageRect(x, y, width, height, "image/jpeg", img, display);
    }

    _webpRect(x, y, width, height, data, display, depth) {
        let img = this._readData(data);
        if (img === null) {
            return false;
        }

        //return this._imageRect(x, y, width, height, "image/webp", img, display);
        display.imageRect(x, y, width, height, "image/webp", img);
        return true;
    }

    _imageRect(x, y, width, height, mime, arr, display) {
        //let blob = new Blob(arr, {'type' : 'image/jpeg'});
	    //return display.drawImage(URL.createObjectURL(blob), x, y, width, height);

        const img = new Image();
        img.src = "data: " + mime + ";base64," + Base64.encode(arr);

        if (img.complete) {
            display.drawImage(img, x, y, width, height);
            Log.Debug("Image rect drawn immediate");
        } else {
            img.addEventListener('load', function() {
                display.drawImage(img, x, y, width, height);
                Log.Debug("Image rect drawn delayed");
            });
        }
        
        return true;
    }

    _validateJPEG(arr) {
        //min size
        if (arr.length < 4) { 
            return false; 
        }
        //SOI
        if (arr[0] !== 255 || arr[1] !== 216) { 
            return false; 
        }
        //JFIF-APP0 (mandatory)
        if (arr[2] !== 255 || arr[3] !== 224) { 
            return false; 
        }
        //get len of APP0
        let applen = parseInt(arr[4] + (arr[5] << 8));
        // Identifier "JFIF" in ASCII
        if (arr[6] !== 74 || arr[7] !== 70 || arr[8] !== 73 || arr[9] !== 70 || arr[10] !== 0 ) { 
            return false; 
        }
        // JFIF version, major and minor
        if (arr[11] !== 1 || arr[12] !== 1) {
            return false;
        }
        let density = arr[13]; //should be 0?
        let Xdensity = arr[14] + (arr[15] << 8); //should be 256?
        let Ydensity = arr[16] + (arr[17] << 8); //shoudl be 256?

        //thumbnail
        if (arr[18] !== 0 || arr[19] !== 0) {
            return false;
        }

        let i = 20;
        while (i < arr.length) {
            i = this._validateJpegSection(arr, i);
            if (!i) {
                return false;
            } 
        }

        return true;
    }

    _validateJpegSection(img, index) {
        //start marker
        if (img[index++] !== 255) {
            return false;
        }
        let sectionType = img[index++];
        let sectionStart = index;
        let sectionLen = parseInt((img[index++] << 8) + img[index++]);
        let sectionEnd = sectionStart + sectionLen;
        let dest, hclass, precision, line, samples;

        switch(sectionType) {
            case 219: //xDB quantization
                dest = img[index++];
                
                break;
            case 192: //Start of frame
                precision = parseInt(img[index++] + (img[index++] << 8));
                line = parseInt(img[index++] + (img[index++] << 8));
                samples = img[index++];
                break;
            case 196: //Huffman table
                dest = img[index++] >> 4;
                hclass = (img[index++] << 4) >> 4;
                break;
            case 218: //start of scan
                if (img[sectionEnd - 1] !== 0 || img[sectionEnd - 2] !== 63 || img[sectionEnd - 3] !== 0) {
                    return false;
                }
                //Data until end
                sectionEnd = img.length - 2;

                //some of our jpegs are missing a byte!
                if (img[sectionEnd] !== 255 && img[sectionEnd + 1] == 255) {
                    
                }

                break;
            case 217: //end of image
                if (index == (img.length - 1)) {
                    return img.length;
                } else {
                    return false;
                }
            default:
                return false;
        }

        if (img[sectionEnd] !== 255) {
            Log.Warn("JPEG missing one byte")
            return false;
        }
        return sectionEnd;
    }

    _pngRect(x, y, width, height, data, display, depth) {
        //throw new Error("PNG received in UDP rect");
        Log.Error("PNG received in UDP rect");
        return false;
    }

    _basicRect(ctl, x, y, width, height, data, display, depth) {
        let zlibs_flags = data[12];

        // Reset streams if the server requests it
        for (let i = 0; i < 4; i++) {
            if ((zlibs_flags >> i) & 1) {
                this._zlibs[i].reset();
                //Log.Info("Reset zlib stream " + i);
            }
        }

        let filter = data[13];
        let data_index = 14;
        let streamId = ctl & 0x3;
        if (!(ctl & 0x4)) {
            // Implicit CopyFilter
            filter = 0;
            data_index = 13;
        }
        //Log.Info("basic Rect StreamID: " + streamId);

        let ret;

        switch (filter) {
            case 0: // CopyFilter
                //Log.Debug("CopyFilter");
                ret = this._copyFilter(streamId, x, y, width, height,
                    data, display, depth, data_index);
                break;
            case 1: // PaletteFilter
                //Log.Debug("PaletteFilter");
                ret = this._paletteFilter(streamId, x, y, width, height,
                    data, display, depth);
                break;
            case 2: // GradientFilter
                ret = this._gradientFilter(streamId, x, y, width, height,
                    data, display, depth);
                break;
            default:
                throw new Error("Illegal tight filter received (ctl: " +
                    this._filter + ")");
        }

        return ret;
    }

    _copyFilter(streamId, x, y, width, height, data, display, depth, data_index=14) {
        const uncompressedSize = width * height * 3;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            data = data.slice(data_index, data_index + uncompressedSize);
        } else {
            data = this._readData(data, data_index);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        let rgbx = new Uint8Array(width * height * 4);
        for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
            rgbx[i] = data[j];
            rgbx[i + 1] = data[j + 1];
            rgbx[i + 2] = data[j + 2];
            rgbx[i + 3] = 255;  // Alpha
        }

        //Log.Debug("CopyFilter x: " + x + " y: " + y + " h: " + height + " w: " + width + " rgb: " + data[data.length - 3] + " " + data[data.length - 2] + " " + data[data.length - 1]);

        display.blitImage(x, y, width, height, rgbx, 0, false);

        return true;
    }

    _paletteFilter(streamId, x, y, width, height, data, display, depth) {
        const numColors = data[14] + 1;
        const paletteSize = numColors * 3;
        let palette = data.slice(15, 15 + paletteSize);

        const bpp = (numColors <= 2) ? 1 : 8;
        const rowSize = Math.floor((width * bpp + 7) / 8);
        const uncompressedSize = rowSize * height;
        let data_i = 15 + paletteSize;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            data = data.slice(data_i, data_i + uncompressedSize);
        } else {
            data = this._readData(data, data_i);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        // Convert indexed (palette based) image data to RGB
        if (this._numColors == 2) {
            this._monoRect(x, y, width, height, data, palette, display);
        } else {
            this._paletteRect(x, y, width, height, data, palette, display);
        }

        return true;
    }

    _monoRect(x, y, width, height, data, palette, display) {
        Log.Debug("mono rect");
        // Convert indexed (palette based) image data to RGB
        // TODO: reduce number of calculations inside loop
        const dest = new Uint8Array(width * height * 4);
        const w = Math.floor((width + 7) / 8);
        const w1 = Math.floor(width / 8);

        for (let y = 0; y < height; y++) {
            let dp, sp, x;
            for (x = 0; x < w1; x++) {
                for (let b = 7; b >= 0; b--) {
                    dp = (y * width + x * 8 + 7 - b) * 4;
                    sp = (data[y * w + x] >> b & 1) * 3;
                    dest[dp] = palette[sp];
                    dest[dp + 1] = palette[sp + 1];
                    dest[dp + 2] = palette[sp + 2];
                    dest[dp + 3] = 255;
                }
            }

            for (let b = 7; b >= 8 - width % 8; b--) {
                dp = (y * width + x * 8 + 7 - b) * 4;
                sp = (data[y * w + x] >> b & 1) * 3;
                dest[dp] = palette[sp];
                dest[dp + 1] = palette[sp + 1];
                dest[dp + 2] = palette[sp + 2];
                dest[dp + 3] = 255;
            }
        }

        //Log.Debug("MonoRect x: " + x + " y: " + y + " h: " + height + " w: " + width + " rgb: " + data[data.length - 3] + " " + data[data.length - 2] + " " + data[data.length - 1]);
        display.blitImage(x, y, width, height, dest, 0, false);

        return true;
    }

    _paletteRect(x, y, width, height, data, palette, display) {
        // Convert indexed (palette based) image data to RGB
        const dest = new Uint8Array(width * height * 4);
        const total = width * height * 4;
        for (let i = 0, j = 0; i < total; i += 4, j++) {
            const sp = data[j] * 3;
            dest[i] = palette[sp];
            dest[i + 1] = palette[sp + 1];
            dest[i + 2] = palette[sp + 2];
            dest[i + 3] = 255;
        }

        //Log.Debug("PaletteRect x: " + x + " y: " + y + " h: " + height + " w: " + width + " rgb: " + dest[dest.length - 3] + " " + dest[dest.length - 2] + " " + dest[dest.length - 1]);
        display.blitImage(x, y, width, height, dest, 0, false);

        return true;
    }

    _gradientFilter(streamId, x, y, width, height, data, display, depth) {
        throw new Error("Gradient filter not implemented");
    }

    _readData(data, len_index = 13) {
        if (data.length < len_index + 2) {
            Log.Error("UDP Decoder, readData, invalid data len")
            return null;
        }


        let i = len_index;
        let byte = data[i++];
        let len = byte & 0x7f;
        // lenth field is variably sized 1 to 3 bytes long
        if (byte & 0x80) {
            byte = data[i++]
            len |= (byte & 0x7f) << 7;
            if (byte & 0x80) {
                byte = data[i++];
                len |= byte << 14;
            }
        }

        //TODO: get rid of me
        if (data.length !== len + i) {
            Log.Error('Invalid data, rect of size ' + len + ' with data size ' + data.length + ' index of ' + i);
            return null;
        }
        

        return data.slice(i);
    }

    _getScratchBuffer(size) {
        if (!this._scratchBuffer || (this._scratchBuffer.length < size)) {
            this._scratchBuffer = new Uint8Array(size);
        }
        return this._scratchBuffer;
    }
}
