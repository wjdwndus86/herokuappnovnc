import Recorder from "./recorder.js";

let recorder = null;

document.querySelector("#kasm_recording_control .record").addEventListener("click", () => {
  if (!recorder) {
    recorder = new Recorder();
    recorder.start();
  } else {
    recorder.stop();
    recorder = null;
  }

  document.querySelector("#kasm_recording_control").classList.toggle("is-recording");
});

//
setInterval(() => {
  if (recorder) {
    const duration = recorder.getDuration();
    document.querySelector("#kasm_recording_control .stats").textContent = `${duration}`;
  }
}, 500);