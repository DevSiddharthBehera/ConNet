import React, { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import API from '../api'
import { Button, Box, Heading, HStack, Text, IconButton, useDisclosure, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Input, Flex, InputGroup, InputRightElement } from '@chakra-ui/react'
import { ArrowForwardIcon, AttachmentIcon, ArrowBackIcon } from '@chakra-ui/icons'
import { PhoneIcon, ViewIcon } from '@chakra-ui/icons'
import VideoModal from './VideoModal'

export default function Chat({ token, user, to, recipient, isMobile, onBack }) {
  const [socket, setSocket] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [incomingCall, setIncomingCall] = useState(null)
  const [inCall, setInCall] = useState(false)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [pc, setPc] = useState(null) // retained for UI state if needed
  const pcRef = useRef(null) // use ref to avoid stale closures in socket handlers
  const callPeerIdRef = useRef(null) // track the other participant's user id for reliable end-call signaling
  const [isSharingScreen, setIsSharingScreen] = useState(false)
  const [onlineIds, setOnlineIds] = useState([])
  const [videoPlaying, setVideoPlaying] = useState({ local: false, remote: false })
  const [callActive, setCallActive] = useState(false)
  const [roomInfo, setRoomInfo] = useState(null)
  const [conversationCache, setConversationCache] = useState({}) // { id: { messages, lastFetched, scrollY } }

  const messagesRef = useRef()
  const localVideoRef = useRef()
  const remoteVideoRef = useRef()
  const activeIdRef = useRef('')
  const isGroupRef = useRef(false)
  const fileInputRef = useRef(null)
  const [selectedFileName, setSelectedFileName] = useState('')

  // Handle conversation changes: always reload from server on click
  useEffect(() => {
    if (!socket || !to) return
    activeIdRef.current = to
    isGroupRef.current = !!recipient?.isGroup
    socket.emit('join-room', to)
    socket.emit('mark-read', { conversationId: to })
    if (recipient && recipient.isGroup) fetchRoomInfo(to); else setRoomInfo(null)
    // Force fresh history fetch every time user/group is selected
    loadHistory(to)
  }, [to, socket, recipient])

  useEffect(() => {}, [to, recipient])

  async function fetchRoomInfo(roomId) {
    try {
      const resp = await API.get(`/rooms/${roomId}`, { headers: { Authorization: `Bearer ${token}` } })
      setRoomInfo(resp.data)
    } catch (err) {
      console.error('Error fetching room info', err)
    }
  }

  const { isOpen: isCallOpen, onOpen: openCallModal, onClose: closeCallModal } = useDisclosure()

  useEffect(() => {
    const s = io('http://localhost:4000', { auth: { token } })
    setSocket(s)

    s.on('connect', () => {})
    s.on('connected', (payload) => {})

    s.on('message', (msg) => {
      const fromId = String(msg?.from?._id || msg?.from?.id || msg?.from)
      const toId = String(msg?.to)
      const myId = String(user?.id || user?._id)
      const activeId = String(activeIdRef.current || '')
      const isGroupActive = isGroupRef.current && activeId
      const isSelfActive = activeId === myId

      let conversationId = null
      if (msg.isGroup) {
        // Always route group messages by room id
        conversationId = toId
        // If room not active, still cache it (handled below)
      } else if (isSelfActive) {
        // Only treat as self note if truly self->self
        if (fromId === myId && toId === myId) {
          conversationId = myId
        } else {
          // Assign to the other user's conversation instead
          conversationId = (fromId === myId) ? toId : fromId
        }
      } else if (fromId === myId) {
        conversationId = toId
      } else if (toId === myId) {
        conversationId = fromId
      }
      if (!conversationId) return

      // update cache always
      setConversationCache(c => {
        const existing = c[conversationId]?.messages || []
        const msgId = (msg._id || msg.id || '').toString()
        if (existing.some(m => (m._id || m.id) && (m._id || m.id).toString() === msgId)) return c
        const updated = [...existing, msg]
        return { ...c, [conversationId]: { messages: updated, lastFetched: Date.now(), scrollY: c[conversationId]?.scrollY || 0 } }
      })

      if (conversationId === activeId) {
        setMessages(prev => {
          const msgId = (msg._id || msg.id || '').toString()
          if (prev.some(m => (m._id || m.id) && (m._id || m.id).toString() === msgId)) return prev
          return [...prev, msg]
        })
      }
    })

    // maintain online user ids for header indicator instead of adding system messages
    s.on('online-list', (list) => {
      try {
        const normalized = (list || []).map(id => String(id))
        setOnlineIds(normalized)
      } catch (err) { /* ignore */ }
    })

    s.on('user-online', (u) => {
      setOnlineIds(prev => {
        try {
          const id = String((u && u.id) || u)
          if (!id) return prev
          if (prev.includes(id)) return prev
          return [...prev, id]
        } catch (err) { return prev }
      })
    })

    s.on('user-offline', (u) => {
      try {
        const idToRemove = String((u && u.id) || u)
        setOnlineIds(prev => prev.filter(id => String(id) !== idToRemove))
      } catch (err) { /* ignore */ }
    })

    s.on('file', (payload) => {
      const fromId = String(payload?.from?._id || payload?.from?.id || payload?.from)
      const myId = String(user?.id || user?._id)
      const activeId = String(activeIdRef.current || '')
      const isGroupActive = isGroupRef.current && activeId
      const isSelfActive = activeId === myId
      let conversationId = null
      if (payload.isGroup) {
        conversationId = String(payload.to)
      } else if (isSelfActive) {
        if (fromId === myId && String(payload?.to) === myId) {
          conversationId = myId
        } else {
          conversationId = (fromId === myId) ? String(payload?.to) : fromId
        }
      } else if (fromId === myId) {
        conversationId = activeId // file I sent belongs to currently open chat id
      } else {
        conversationId = fromId
      }
      if (!conversationId) return

      setConversationCache(c => {
        const existing = c[conversationId]?.messages || []
        if (payload && payload.url && existing.some(m => m.file && m.file.url === payload.url)) return c
        const updated = [...existing, { from: payload.from, file: payload }]
        return { ...c, [conversationId]: { messages: updated, lastFetched: Date.now(), scrollY: c[conversationId]?.scrollY || 0 } }
      })
      if (conversationId === activeId) {
        setMessages(prev => {
          if (payload && payload.url && prev.some(m => m.file && m.file.url === payload.url)) return prev
          return [...prev, { from: payload.from, file: payload }]
        })
      }
    })

    // WebRTC signalling
    s.on('incoming-call', ({ from, offer }) => {
      setIncomingCall({ from, offer })
      setMessages(prev => [...prev, { system: true, text: `Incoming call from ${from.username}` }])
    })

    s.on('call-answered', async ({ from, answer }) => {
      const peer = pcRef.current
      if (peer) {
          try {
          await peer.setRemoteDescription(answer)
        } catch (err) { console.error('call-answered remote desc error', err) }
      } else {
        console.warn('call-answered: pcRef.current missing')
      }
      setInCall(true)
    })

    s.on('ice-candidate', async ({ from, candidate }) => {
      const peer = pcRef.current
      if (peer && candidate) {
        try { 
          await peer.addIceCandidate(candidate) 
        } catch (err) { console.error('Add ICE error', err) }
      } else if (!peer) {
        console.warn('ice-candidate received but pcRef.current is null')
      }
    })

    s.on('call-ended', ({ from }) => {
      endCall(false)
      setMessages(prev => [...prev, { system: true, text: `Call ended by ${from.username}` }])
    })

    return () => { s.disconnect() }
  }, [token])

  useEffect(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight }, [messages])

  async function loadHistory(target) {
    const dest = target || to
    if (!dest) return
    try {
      const resp = await API.get(`/messages/${dest}?limit=500`, { headers: { Authorization: `Bearer ${token}` } })
      const all = resp.data || []
      // filter to last 1 month
      const since = new Date(); since.setMonth(since.getMonth() - 1)
      const filtered = (all || []).filter(m => {
        const t = new Date(m.createdAt || m.created_at || m.created)
        return !isNaN(t.getTime()) ? t >= since : false
      })
      filtered.sort((a, b) => new Date(a.createdAt || a.created_at || a.created) - new Date(b.createdAt || b.created_at || b.created))
      setMessages(filtered)
      setConversationCache(c => ({
        ...c,
        [dest]: { messages: filtered, lastFetched: Date.now(), scrollY: c[dest]?.scrollY || 0 }
      }))
    } catch (err) {
      console.error('Error loading history', err)
    }
  }

  async function sendMessage() {
    const dest = to
    if (!dest || !text) return
    const payload = { to: dest, content: text, meta: {} }
    socket.emit('message', payload)
    setText('')
  }

  async function sendFile(e) {
    const file = e.target.files[0]
    if (!file || !to) return
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('to', to)
      const resp = await API.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` } })
      // server will emit the file event to recipient and back to sender; don't duplicate here
    } catch (err) {
      console.error('Upload failed', err)
    }
  }

  async function startCall() {
    if (!to) return alert('Set recipient userId or roomId')
    try {
    const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      setLocalStream(local)
      setCallActive(true)
      // Delay modal opening to ensure state updates first
      setTimeout(() => openCallModal(), 100)

      const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      const newPc = new RTCPeerConnection(configuration)
      pcRef.current = newPc
      setPc(newPc)
      callPeerIdRef.current = to

      // add local tracks
      local.getTracks().forEach(track => newPc.addTrack(track, local))

      newPc.ontrack = (ev) => {
        setRemoteStream(ev.streams[0])
      }

      newPc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', { to, candidate: event.candidate })
      }

      const offer = await newPc.createOffer()
      await newPc.setLocalDescription(offer)
      socket.emit('call-user', { to, offer })
      setInCall(true)
    } catch (err) {
      console.error('Start call error', err)
    }
  }

  async function acceptCall() {
    if (!incomingCall) return
    const { from, offer } = incomingCall
    try {
    const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      setLocalStream(local)
      // Ensure callActive is true so modal renders
      setCallActive(true)
      openCallModal()

      const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      const newPc = new RTCPeerConnection(configuration)
      pcRef.current = newPc
      setPc(newPc)
      callPeerIdRef.current = from.id

      local.getTracks().forEach(track => newPc.addTrack(track, local))

      newPc.ontrack = (ev) => {
        setRemoteStream(ev.streams[0])
      }

      newPc.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', { to: from.id, candidate: event.candidate })
      }

      await newPc.setRemoteDescription(offer)
      const answer = await newPc.createAnswer()
      await newPc.setLocalDescription(answer)
      socket.emit('answer-call', { to: from.id, answer })
      setInCall(true)
      setIncomingCall(null)
    } catch (err) {
      console.error('Accept call error', err)
    }
  }

  function declineCall() {
    setIncomingCall(null)
  }

  function endCall(emit = true) {
    try {
      const peer = pcRef.current
      if (peer) {
        peer.getSenders().forEach(s => s.track && s.track.stop())
        peer.close()
      }
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop())
        setLocalStream(null)
      }
      setPc(null)
      pcRef.current = null
      setRemoteStream(null)
      setInCall(false)
      setCallActive(false)
      setVideoPlaying({ local: false, remote: false })
      // Emit end-call to the other user's id (not the room/self id)
      if (emit && socket && callPeerIdRef.current) {
        socket.emit('end-call', { to: callPeerIdRef.current })
      }
    } catch (err) { console.error(err) }
  }

  async function toggleScreenShare() {
    if (!pc) return
    try {
      if (!isSharingScreen) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = screenStream.getVideoTracks()[0]
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
        if (sender) sender.replaceTrack(screenTrack)
        screenTrack.onended = async () => { await toggleScreenShare() }
        setIsSharingScreen(true)
      } else {
        // stop screen sharing: try to get camera video and replace
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
        const camTrack = camStream.getVideoTracks()[0]
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
        if (sender) sender.replaceTrack(camTrack)
        setIsSharingScreen(false)
      }
    } catch (err) { console.error('Screen share error', err) }
  }

  // sign out is handled in Header; Chat doesn't manage auth here

  return (
    <div>
      <Box mb={4} p={3} bg="white" borderRadius="md" boxShadow="sm">
        <HStack justify="space-between">
          <Box>
            <HStack spacing={3} align="center">
              <Box position="relative">
                <Avatar size="md" name={recipient?.displayName || recipient?.username} />
                {recipient?.id && !recipient?.isGroup && onlineIds.includes(String(recipient.id)) && (
                  <Box position="absolute" bottom={0} right={0} w={3} h={3} bg="green.400" borderRadius="full" border="2px solid white" />
                )}
              </Box>
              <Box>
                <Heading size="sm">{recipient?.displayName || 'No recipient selected'}</Heading>
                <Text fontSize="sm" color="gray.500">
                  {!recipient?.id ? 'Select a person or group on the left' :
                   recipient?.isGroup ? `${roomInfo?.members?.length || 0} members` :
                   onlineIds.includes(String(recipient.id)) ? 'Online' : 'Offline'}
                </Text>
              </Box>
            </HStack>
          </Box>
          <HStack>
            {isMobile && recipient?.id && (
              <IconButton aria-label="Back" icon={<ArrowBackIcon />} onClick={() => onBack && onBack()} />
            )}
            {recipient?.id && (
              // Show for group chats OR other user (not self). Hide only for self-notepad or when no recipient.
              (recipient?.isGroup || String(recipient.id) !== String(user?.id || user?._id)) && (
                <>
                  <IconButton aria-label="Start call" icon={<PhoneIcon />} onClick={startCall} />
                  <IconButton aria-label="Share screen" icon={<ViewIcon />} onClick={toggleScreenShare} />
                </>
              )
            )}
          </HStack>
        </HStack>
      </Box>

      <VideoModal 
        isOpen={isCallOpen && callActive}
        onClose={() => { setCallActive(false); closeCallModal(); endCall(true); }}
        localStream={localStream}
        remoteStream={remoteStream}
        recipient={recipient}
        onEndCall={() => { setCallActive(false); closeCallModal(); endCall(true); }}
      />

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="messages" ref={messagesRef}>
            {messages.map((m, i) => {
              if (m.system) return (<div key={i} className="meta" style={{ textAlign: 'center', color: '#666', margin: 8 }}>{m.text}</div>)
              const fromId = (m.from && (m.from._id || m.from.id || m.from)) || m.from
              const myId = user?.id || user?._id
              const isMe = String(fromId) === String(myId)
              const content = m.content || m.text || ''
              return (
                <div key={m._id || m.id || i} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', padding: '6px 0' }}>
                  <div style={{ background: isMe ? '#3182ce' : '#edf2f7', color: isMe ? 'white' : 'black', padding: '8px 12px', borderRadius: 8, maxWidth: '70%' }}>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{content}</div>
                    <div style={{ fontSize: 11, color: isMe ? '#e6f0ff' : '#666', marginTop: 6, textAlign: 'right' }}>{new Date(m.createdAt || m.created_at || m.created).toLocaleString()}</div>
                  </div>
                </div>
              )
            })}
          </div>

          <Box mt={3}>
            <Flex align="center" gap={3}>
              <InputGroup>
                <Input
                  placeholder="Message"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendMessage() }}
                />
                <InputRightElement>
                  <IconButton aria-label="Send message" icon={<ArrowForwardIcon />} size="sm" colorScheme="blue" onClick={sendMessage} />
                </InputRightElement>
              </InputGroup>

              <IconButton aria-label="Attach file" icon={<AttachmentIcon />} variant="outline" onClick={() => fileInputRef.current && fileInputRef.current.click()} />
              {selectedFileName ? (
                <Text fontSize="sm" color="gray.600" noOfLines={1} isTruncated maxW="200px">{selectedFileName}</Text>
              ) : null}
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => {
                const f = e.target.files && e.target.files[0]
                setSelectedFileName(f ? f.name : '')
                sendFile(e)
              }} />
            </Flex>
          </Box>
        </div>
      </div>

      <Modal isOpen={!!incomingCall} onClose={declineCall} isCentered size="sm" closeOnOverlayClick={false}>
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent>
          <ModalHeader px={4} py={3}>Incoming Call</ModalHeader>
          <ModalBody pt={0} pb={2}>
            {incomingCall && (
              <HStack spacing={4} align="center">
                <Avatar name={incomingCall.from.displayName || incomingCall.from.username} />
                <Box>
                  <Text fontWeight="semibold" fontSize="sm">{incomingCall.from.displayName || incomingCall.from.username}</Text>
                  <Text fontSize="xs" color="gray.500">is calling you...</Text>
                </Box>
              </HStack>
            )}
          </ModalBody>
          <ModalFooter pt={0} pb={4} display="flex" justifyContent="space-between">
            <Button onClick={declineCall} variant="outline" colorScheme="red">Decline</Button>
            <Button onClick={acceptCall} colorScheme="green">Accept</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
