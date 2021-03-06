/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* global TimelineDataSeries, TimelineGraphView */

'use strict';

var audio2 = document.querySelector('audio#audio2');
var callButton = document.querySelector('button#callButton');
var hangupButton = document.querySelector('button#hangupButton');
var codecSelector = document.querySelector('select#codec');
var callstats = new callstats(null,io,jsSHA);

hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

callstats.initialize(842748708, "CuXT/0zOOd9R:7TL8LgESzRqEDTZcIMh6IWta+qdhKe5wkLciF5yTQNw=", "testID");

var pc1;
var pc2;
var localStream;

var bitrateGraph;
var bitrateSeries;

var packetGraph;
var packetSeries;

var lastResult;

var offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0,
  voiceActivityDetection: false
};

function gotStream(stream) {
  hangupButton.disabled = false;
  trace('Received local stream');
  localStream = stream;
  var audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    trace('Using Audio device: ' + audioTracks[0].label);
  }
  pc1.addStream(localStream);
  trace('Adding Local Stream to peer connection');

  pc1.createOffer(
    offerOptions
  ).then(
    gotDescription1,
    onCreateSessionDescriptionError(pc1, "createOffer")
  );

  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView('bitrateGraph', 'bitrateCanvas');
  bitrateGraph.updateEndDate();

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView('packetGraph', 'packetCanvas');
  packetGraph.updateEndDate();
}

function onCreateSessionDescriptionError(pc, action) {
  return function(error) {
    callstats.reportError(pc, "test", action, error)
    trace('Failed to create session description: ' + error.toString());
  }
}

function call() {
  callButton.disabled = true;
  codecSelector.disabled = true;
  trace('Starting call');
  var servers = null;
  var pcConstraints = {
    'optional': []
  };
  pc1 = new RTCPeerConnection(servers, pcConstraints);
  trace('Created local peer connection object pc1');
  pc1.onicecandidate = iceCallback1;
  pc2 = new RTCPeerConnection(servers, pcConstraints);
  trace('Created remote peer connection object pc2');
  pc2.onicecandidate = iceCallback2;
  pc2.onaddstream = gotRemoteStream;

  callstats.addNewFabric(pc1, "testID1", "audio", "test");
  callstats.addNewFabric(pc2, "testID2", "audio", "test");

  trace('Requesting local stream');
  navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false
  })
  .then(gotStream)
  .catch(function(e) {
    callstats.reportError(pc1, "test", "getUserMedia", e)
    alert('getUserMedia() error: ' + e.name);
  });
}

function gotDescription1(desc) {
  trace('Offer from pc1 \n' + desc.sdp);
  pc1.setLocalDescription(desc).then(
    function() {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
      pc2.setRemoteDescription(desc).then(
        function() {
          pc2.createAnswer().then(
            gotDescription2,
            onCreateSessionDescriptionError(pc2, "createAnswer")
          );
        },
        onSetSessionDescriptionError(pc2, "setRemoteDescription")
      );
    },
    onSetSessionDescriptionError(pc1, "setLocalDescription")
  );
}

function gotDescription2(desc) {
  trace('Answer from pc2 \n' + desc.sdp);
  pc2.setLocalDescription(desc).then(
    function() {
      desc.sdp = forceChosenAudioCodec(desc.sdp);
      pc1.setRemoteDescription(desc).then(
        function() {
        },
        onSetSessionDescriptionError(pc1, "setRemoteDescription")
      );
    },
    onSetSessionDescriptionError(pc2, "setLocalDescription")
  );
}

function hangup() {
  trace('Ending call');
  localStream.getTracks().forEach(function(track) {
    track.stop();
  });
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  codecSelector.disabled = false;
}

function gotRemoteStream(e) {
  audio2.srcObject = e.stream;
  trace('Received remote stream');
}

function iceCallback1(event) {
  if (event.candidate) {
    pc2.addIceCandidate(
      new RTCIceCandidate(event.candidate)
    ).then(
      onAddIceCandidateSuccess,
      onAddIceCandidateError(pc2)
    );
    trace('Local ICE candidate: \n' + event.candidate.candidate);
  }
}

function iceCallback2(event) {
  if (event.candidate) {
    pc1.addIceCandidate(
      new RTCIceCandidate(event.candidate)
    ).then(
      onAddIceCandidateSuccess,
      onAddIceCandidateError(pc1)
    );
    trace('Remote ICE candidate: \n ' + event.candidate.candidate);
  }
}

function onCreateSessionDescriptionError(pc, action) {
  return function(error) {
    callstats.reportError(pc, "test", action, error)
    trace('Failed to create session description: ' + error.toString());
  }
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success.');
}

function onAddIceCandidateError(pc) {
  return function(error) {
    callstats.reportError(pc, "test", "addIceCandidate", error)
    trace('Failed to add ICE Candidate: ' + error.toString());
  }
}

function onSetSessionDescriptionError(pc, action) {
  return function(error) {
    callstats.reportError(pc, "test", action, error)
    trace('Failed to set session description: ' + error.toString());
  }
}

function forceChosenAudioCodec(sdp) {
  return maybePreferCodec(sdp, 'audio', 'send', codecSelector.value);
}

// Copied from AppRTC's sdputils.js:

// Sets |codec| as the default |type| codec if it's present.
// The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'.
function maybePreferCodec(sdp, type, dir, codec) {
  var str = type + ' ' + dir + ' codec';
  if (codec === '') {
    trace('No preference on ' + str + '.');
    return sdp;
  }

  trace('Prefer ' + str + ': ' + codec);

  var sdpLines = sdp.split('\r\n');

  // Search for m line.
  var mLineIndex = findLine(sdpLines, 'm=', type);
  if (mLineIndex === null) {
    return sdp;
  }

  // If the codec is available, set it as the default in m line.
  var codecIndex = findLine(sdpLines, 'a=rtpmap', codec);
  console.log('codecIndex', codecIndex);
  if (codecIndex) {
    var payload = getCodecPayloadType(sdpLines[codecIndex]);
    if (payload) {
      sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
    }
  }

  sdp = sdpLines.join('\r\n');
  return sdp;
}

// Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).
function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

// Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).
function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  var realEndLine = endLine !== -1 ? endLine : sdpLines.length;
  for (var i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (!substr ||
          sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1) {
        return i;
      }
    }
  }
  return null;
}

// Gets the codec payload type from an a=rtpmap:X line.
function getCodecPayloadType(sdpLine) {
  var pattern = new RegExp('a=rtpmap:(\\d+) \\w+\\/\\d+');
  var result = sdpLine.match(pattern);
  return (result && result.length === 2) ? result[1] : null;
}

// Returns a new m= line with the specified codec as the first one.
function setDefaultCodec(mLine, payload) {
  var elements = mLine.split(' ');

  // Just copy the first three parameters; codec order starts on fourth.
  var newLine = elements.slice(0, 3);

  // Put target payload first and copy in the rest.
  newLine.push(payload);
  for (var i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }
  return newLine.join(' ');
}

// query getStats every second
window.setInterval(function() {
  if (!window.pc1) {
    return;
  }
  window.pc1.getStats(null).then(function(res) {
    Object.keys(res).forEach(function(key) {
      var report = res[key];
      var bytes;
      var packets;
      var now = report.timestamp;
      if ((report.type === 'outboundrtp') ||
          (report.type === 'outbound-rtp') ||
          (report.type === 'ssrc' && report.bytesSent)) {
        bytes = report.bytesSent;
        packets = report.packetsSent;
        if (lastResult && lastResult[report.id]) {
          // calculate bitrate
          var bitrate = 8 * (bytes - lastResult[report.id].bytesSent) /
              (now - lastResult[report.id].timestamp);

          // append to chart
          bitrateSeries.addPoint(now, bitrate);
          bitrateGraph.setDataSeries([bitrateSeries]);
          bitrateGraph.updateEndDate();

          // calculate number of packets and append to chart
          packetSeries.addPoint(now, packets -
              lastResult[report.id].packetsSent);
          packetGraph.setDataSeries([packetSeries]);
          packetGraph.updateEndDate();
        }
      }
    });
    lastResult = res;
  });
}, 1000);
