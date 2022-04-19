import React, { useState, useEffect, useRef } from "react";
import { SignalingClient } from "amazon-kinesis-video-streams-webrtc";
import AWS from "aws-sdk";

export default async function Interface() {
  const {
    REACT_APP_ACCESS_CODE: access,
    REACT_APP_SECRET_ACCESS_CODE: secret,
  } = process.env;

  let localVideoRef = useRef(null);
  let remoteViewRef = useRef(null);
  let localView = useRef(null);
  let remoteView = useRef(null);

  // DescribeSignalingChannel API can also be used to get the ARN from a channel name.
  const channelARN =
    "arn:aws:kinesisvideo:us-east-1:620899590002:channel/testing-webRTC/1650029117785";

  // AWS Credentials
  const accessKeyId = access;
  const secretAccessKey = secret;

  const region = "us-east-1";
  const clientId = "room1";

  const kinesisVideoClient = new AWS.KinesisVideo({
    region,
    accessKeyId,
    secretAccessKey,
    correctClockSkew: true,
  });

  const getSignalingChannelEndpointResponse = await kinesisVideoClient
    .getSignalingChannelEndpoint({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ["WSS", "HTTPS"],
        Role: KVSWebRTC.Role.VIEWER,
      },
    })
    .promise();

  const endpointsByProtocol =
    getSignalingChannelEndpointResponse.ResourceEndpointList.reduce(
      (endpoints, endpoint) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
      },
      {}
    );

  useEffect(() => {
    const initLocalStream = async () => {
      await navigator.mediaDevices
        .getUserMedia({
          video: true,
          audio: true,
        })
        .then((stream) => {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true;
          localView = stream;
        });
    };
    initLocalStream();
  }, []);

  const kinesisVideoSignalingChannelsClient =
    new AWS.KinesisVideoSignalingChannels({
      region,
      accessKeyId,
      secretAccessKey,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });

  const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
    .getIceServerConfig({
      ChannelARN: channelARN,
    })
    .promise();
  const iceServers = [
    { urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` },
  ];
  getIceServerConfigResponse.IceServerList.forEach((iceServer) =>
    iceServers.push({
      urls: iceServer.Uris,
      username: iceServer.Username,
      credential: iceServer.Password,
    })
  );

  const peerConnection = new RTCPeerConnection({ iceServers });

  SignalingClient = new KVSWebRTC.SignalingClient({
    channelARN,
    channelEndpoint: endpointsByProtocol.WSS,
    clientId,
    role: KVSWebRTC.Role.VIEWER,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    systemClockOffset: kinesisVideoClient.config.systemClockOffset,
  });

  return (
    <div className="container">
      <video
        className="video-player"
        id="user-2"
        ref={remoteViewRef}
        autoPlay
        playsInline
      />
      <div id="videos">
        <video
          className="video-player"
          id="user-1"
          ref={localVideoRef}
          autoPlay
          playsInline
        />
      </div>
      <button id="offer">Start Call</button>
    </div>
  );
}
