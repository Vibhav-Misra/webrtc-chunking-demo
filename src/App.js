import React, { useState, useRef } from 'react';

function App() {

  const sendChannelRef = useRef(null);       
  const [chunkCount, setChunkCount] = useState(0);
  const [videoURL, setVideoURL] = useState(null);
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [rtcStatus, setRtcStatus] = useState('Not Connected');
  const [sendProgress, setSendProgress] = useState(0);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [receivedChunksCount, setReceivedChunksCount] = useState(0);
  const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024;
  const receivedChunksRef = useRef([]);

  const waitForDrain = () => {
    return new Promise((resolve) => {
      const check = () => {
        if (sendChannelRef.current?.bufferedAmount < MAX_BUFFERED_AMOUNT / 2) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  };

  // Uploaded File
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setTotalSize(file.size);
    const chunkSize = 256 * 1024;
    let offset = 0;
    let index = 0;
    const reader = new FileReader();

    const readNextChunk = () => {
      if (offset >= file.size) return;
      const chunk = file.slice(offset, offset + chunkSize);
      reader.readAsArrayBuffer(chunk);
    };

    reader.onload = async (event) => {
      const chunk = event.target.result;
      console.log(`Upload Chunk #${index} | Size: ${chunk.byteLength} bytes`);
      setSendProgress(prev => prev + chunk.byteLength);
      setChunkCount((prev) => prev + 1);

      if (sendChannelRef.current?.readyState === 'open') {
        let sent = false;
        while (!sent) {
          try {
            if (sendChannelRef.current.bufferedAmount > MAX_BUFFERED_AMOUNT) {
              await new Promise((r) => setTimeout(r, 50));
            }
            sendChannelRef.current.send(chunk);
            sent = true;
          } catch (err) {
            console.warn(`Retrying chunk #${index} due to send failure...`);
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }

      offset += chunkSize;
      index++;
      readNextChunk(); 

    };

    readNextChunk(); 

  };


  // Recorded Video
  const handleStartRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoRef.current.srcObject = stream;
    videoRef.current.play();
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp8' });
    mediaRecorderRef.current = mediaRecorder;
    const recordedChunks = [];
    let index = 0;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        event.data.arrayBuffer().then((buffer) => {
          console.log(`Recorded Chunk #${index} | Size: ${buffer.byteLength} bytes`);
          recordedChunks.push(buffer);
          setChunkCount((prev) => prev + 1);
          index++;
          if (sendChannelRef.current?.readyState === 'open') {
            if (
              sendChannelRef.current &&
              sendChannelRef.current.readyState === 'open'
            ) {
              try {
                sendChannelRef.current.send(buffer);
              } catch (err) {
                console.warn(`Failed to send chunk #${index}:`, err);
              }
            } else {
              console.warn(`Send channel not open for chunk #${index}. It may be lost.`);
            }
          }
        });
      }
    };

    mediaRecorder.start(1000); 
    console.log("Recording started...");

  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    console.log("Recording stopped.");
  };

  const handleRebuild = () => {
    if (!receivedChunksRef.current.length) {
      alert("No received chunks available!");
      return;
    }

    const blob = new Blob(receivedChunksRef.current.map((c) => new Uint8Array(c)), { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    setVideoURL(url);

  };


  // WebRTC Setup
  const initWebRTC = async () => {
    const localConnection = new RTCPeerConnection();
    const remoteConnection = new RTCPeerConnection();
    const sendChannel = localConnection.createDataChannel('sendDataChannel');
    sendChannel.binaryType = 'arraybuffer';
    sendChannelRef.current = sendChannel;

    sendChannel.onopen = () => {
      console.log('Send channel open');
      setRtcStatus('Connected');
    };

    sendChannel.onclose = () => {
      console.warn('Send channel closed — future chunks will be dropped.');
      setRtcStatus('Disconnected');
    };

    remoteConnection.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      receiveChannel.binaryType = 'arraybuffer';
      receiveChannel.onmessage = (event) => {
        setReceiveProgress(prev => prev + event.data.byteLength);
        receivedChunksRef.current.push(event.data);
        setReceivedChunksCount(prev => prev + 1); 
        console.log(`Received chunk: ${event.data.byteLength} bytes`);
      };
    };

    localConnection.onicecandidate = (e) => {
      if (e.candidate) remoteConnection.addIceCandidate(e.candidate);
    };

    remoteConnection.onicecandidate = (e) => {
      if (e.candidate) localConnection.addIceCandidate(e.candidate);
    };

    const offer = await localConnection.createOffer();
    await localConnection.setLocalDescription(offer);
    await remoteConnection.setRemoteDescription(offer);

    const answer = await remoteConnection.createAnswer();
    await remoteConnection.setLocalDescription(answer);
    await localConnection.setRemoteDescription(answer);

    console.log("WebRTC peer connection established.");

  };


  // jsx
  return (
    <div style={{ padding: 20 }}>
      <h2>Real-Time Video Chunking Proof</h2>

      <h3>Upload Video</h3>
      <input type="file" accept="video/mp4,video/webm" onChange={handleFileUpload} />

      <h3>Record Video</h3>
      <video ref={videoRef} width="640" height="360" controls muted />
      <br />
      <button onClick={handleStartRecording}>Start Recording</button>
      <button onClick={handleStopRecording}>Stop Recording</button>

      <h3>WebRTC Setup</h3>
      <button onClick={initWebRTC}>Start WebRTC</button>
      <p><strong>WebRTC Status:</strong> {rtcStatus}</p>

      <h3>Chunks Received: {chunkCount}</h3>
      <button onClick={handleRebuild}>Rebuild & Preview Video</button>
      <div className="progress">
        <div className="label">Send Progress:</div>
        <progress value={sendProgress} max={totalSize}></progress>
      </div>

      <div className="progress">
        <div className="label">Receive Progress:</div>
        <progress value={receiveProgress} max={totalSize}></progress>
      </div>

      {chunkCount > 0 && (
        <p>
          <strong>Loss Rate:</strong> {(((chunkCount - receivedChunksCount) / chunkCount) * 100).toFixed(2)}%
        </p>
      )}

      {videoURL && (
        <div>
          <h4>Preview:</h4>
          <video src={videoURL} controls width="640" />
          <br />
          <a href={videoURL} download="rebuilt_video.webm">Download Video</a>
        </div>
      )}
    </div>
  );
}

export default App;
