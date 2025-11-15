import React, { useEffect, useRef } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@chakra-ui/react";

export default function VideoModal({
  isOpen,
  onClose,
  localStream,
  remoteStream,
  recipient,
  onEndCall,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Give the DOM a moment to render the video elements
    const timeout = setTimeout(() => {
      if (localVideoRef.current && localStream) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.muted = true;
        localVideoRef.current
          .play()
          .catch((err) => console.error("Local play error:", err.message));
      }
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.muted = false;
        remoteVideoRef.current
          .play()
          .catch((err) => console.error("Remote play error:", err.message));
      }
    }, 50);

    return () => clearTimeout(timeout);
  }, [isOpen, localStream, remoteStream]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          Call with {recipient?.displayName || recipient?.id}
        </ModalHeader>
        <ModalBody>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div style={{ width: "100%" }}>
              <p
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  margin: "0 0 8px 0",
                }}
              >
                Remote
              </p>
              <video
                ref={remoteVideoRef}
                playsInline
                autoPlay
                style={{
                  width: "100%",
                  height: "300px",
                  background: "#000",
                  borderRadius: "8px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
            <div style={{ width: "100%" }}>
              <p
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  margin: "0 0 8px 0",
                }}
              >
                Local
              </p>
              <video
                ref={localVideoRef}
                playsInline
                autoPlay
                muted
                style={{
                  width: "100%",
                  height: "300px",
                  background: "#000",
                  borderRadius: "8px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="red" onClick={onEndCall}>
            End Call
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
