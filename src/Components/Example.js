import React from "react";
import AWS from "aws-sdk";

const viewer = {};

function uid() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

class LiveFeedView extends React.Component {
  constructor(props) {
    super(props);
    this.videoRef = React.createRef();
  }

  componentWillUnmount() {
    console.log("[VIEWER] Stopping viewer connection");
    if (viewer.signalingClient) {
      viewer.signalingClient.close();
      viewer.signalingClient = null;
    }

    if (viewer.peerConnection) {
      viewer.peerConnection.close();
      viewer.peerConnection = null;
    }

    if (viewer.remoteStream) {
      viewer.remoteStream.getTracks().forEach((track) => track.stop());
      viewer.remoteStream = null;
    }

    if (viewer.peerConnectionStatsInterval) {
      clearInterval(viewer.peerConnectionStatsInterval);
      viewer.peerConnectionStatsInterval = null;
    }

    if (viewer.remoteView) {
      viewer.remoteView.srcObject = null;
    }

    if (viewer.dataChannel) {
      viewer.dataChannel = null;
    }
  }

  async componentDidMount() {
    // Create KVS client
    const kinesisVideoClient = new AWS.KinesisVideo({
      region: this.props.formValues.region,
      accessKeyId: this.props.formValues.accessKeyId,
      secretAccessKey: this.props.formValues.secretAccessKey,
      sessionToken: this.props.formValues.sessionToken,
      endpoint: this.props.formValues.endpoint,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
      .describeSignalingChannel({
        ChannelName: this.props.formValues.channelName,
      })
      .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
    console.log("[VIEWER] Channel ARN: ", channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
      .getSignalingChannelEndpoint({
        ChannelARN: channelARN,
        SingleMasterChannelEndpointConfiguration: {
          Protocols: ["WSS", "HTTPS"],
          Role: window.KVSWebRTC.Role.VIEWER,
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
    console.log("[VIEWER] Endpoints: ", endpointsByProtocol);

    const kinesisVideoSignalingChannelsClient =
      new AWS.KinesisVideoSignalingChannels({
        region: this.props.formValues.region,
        accessKeyId: this.props.formValues.accessKeyId,
        secretAccessKey: this.props.formValues.secretAccessKey,
        sessionToken: this.props.formValues.sessionToken,
        endpoint: endpointsByProtocol.HTTPS,
      });

    // Get ICE server configuration
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
      .getIceServerConfig({
        ChannelARN: channelARN,
      })
      .promise();

    const iceServers = [];
    iceServers.push({
      urls: `stun:stun.kinesisvideo.${this.props.formValues.region}.amazonaws.com:443`,
    });
    //if (!formValues.natTraversalDisabled) {
    getIceServerConfigResponse.IceServerList.forEach((iceServer) =>
      iceServers.push({
        urls: iceServer.Uris,
        username: iceServer.Username,
        credential: iceServer.Password,
      })
    );
    //}
    console.log("[VIEWER] ICE servers: ", iceServers);

    // Create Signaling Client
    viewer.signalingClient = new window.KVSWebRTC.SignalingClient({
      channelARN,
      channelEndpoint: endpointsByProtocol.WSS,
      clientId: uid(),
      role: window.KVSWebRTC.Role.VIEWER,
      region: 'us-east-1',
      credentials: {
        accessKeyId: this.props.formValues.accessKeyId,
        secretAccessKey: this.props.formValues.secretAccessKey,
      },
    });

    const configuration = {
      iceServers,
      iceTransportPolicy: "all",
    };
    viewer.peerConnection = new RTCPeerConnection(configuration);

    viewer.signalingClient.on("open", async () => {
      console.log("[VIEWER] Connected to signaling service");

      // Create an SDP offer to send to the master
      console.log("[VIEWER] Creating SDP offer");
      await viewer.peerConnection.setLocalDescription(
        await viewer.peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        })
      );

      // When trickle ICE is enabled, send the offer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
      console.log("[VIEWER] Sending SDP offer");
      viewer.signalingClient.sendSdpOffer(
        viewer.peerConnection.localDescription
      );
      console.log("[VIEWER] Generating ICE candidates");
    });

    viewer.signalingClient.on("sdpAnswer", async (answer) => {
      // Add the SDP answer to the peer connection
      console.log("[VIEWER] Received SDP answer");
      await viewer.peerConnection.setRemoteDescription(answer);
    });

    viewer.signalingClient.on("iceCandidate", (candidate) => {
      // Add the ICE candidate received from the MASTER to the peer connection
      console.log("[VIEWER] Received ICE candidate");
      viewer.peerConnection.addIceCandidate(candidate);
    });

    viewer.signalingClient.on("close", () => {
      console.log("[VIEWER] Disconnected from signaling channel");
    });

    viewer.signalingClient.on("error", (error) => {
      console.error("[VIEWER] Signaling client error: ", error);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate) {
        console.log("[VIEWER] Generated ICE candidate");

        // When trickle ICE is enabled, send the ICE candidates as they are generated.
        console.log("[VIEWER] Sending ICE candidate");
        viewer.signalingClient.sendIceCandidate(candidate);
      } else {
        console.log("[VIEWER] All ICE candidates have been generated");
      }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener("track", async (event) => {
      console.log("[VIEWER] Received remote track");
      // if (remoteView.srcObject) {
      //     return;
      // }
      viewer.remoteStream = event.streams[0];
      //this.setState({streamURL: event.streams[0]});
      this.videoRef.current.srcObject = event.streams[0];
    });

    console.log("[VIEWER] Starting viewer connection");
    viewer.signalingClient.open();
  }

  render() {
    return (
      <video
        ref={this.videoRef}
        style={{
          width: "100%",
          minHeight: "500px",
          maxHeight: "100px",
          position: "relative",
        }}
        autoPlay
        playsInline
      />
    );
  }
}

function App() {
  const opts = {
    accessKeyId: "<your access key id>",
    secretAccessKey: "<your secret key>",
    region: "<region>",
    channelName: "<your channel>",
  };
  return (
    <div className="App">
      <LiveFeedView formValues={opts}></LiveFeedView>
    </div>
  );
}

export default App;
