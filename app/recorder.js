const generateUUID = () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
  (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
);

const formatDurationTime = (time) => {
  let hours   = Math.floor(time / 3600);
  let minutes = Math.floor((time - (hours * 3600)) / 60);
  let seconds = Math.floor(time - (hours * 3600) - (minutes * 60));

  if (hours   < 10) { hours   = "0" + hours; }
  if (minutes < 10) { minutes = "0" + minutes; }
  if (seconds < 10) { seconds = "0" + seconds; }

  return `${hours}:${minutes}:${seconds}`;
}

class Recorder {
  constructor() {
    this.recorder = null;
    this.startTime = null;
  }

  start() {
    const canvasEl = document.querySelector("canvas");
    const stream = canvasEl.captureStream(30);

    this.recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 128000, // 128 Kbit/sec
      ideoBitsPerSecond: 2500000, // 2.5 Mbit/sec
      mimeType: "video/webm; codecs=vp9"
    });

    this.recorder.ondataavailable = (e) => {
      const blob = new Blob([e.data], { type: "video/webm" });
      const downloadLink = document.createElement("a");
      downloadLink.download = `${generateUUID()}.webm`;
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.dispatchEvent(new MouseEvent("click"));
      setTimeout(() => URL.revokeObjectURL(downloadLink.href), 1);
    }

    this.recorder.start();
    this.startTime = Date.now();
  }

  stop() {
    this.recorder.stop();
  }

  getDuration() {
    const durationInS = (Date.now() - this.startTime) / 1000;
    return formatDurationTime(durationInS);
  }
}

export default Recorder;