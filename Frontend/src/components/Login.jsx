import React, { useState } from 'react'
import API from '../api'
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Heading,
  Text,
  VStack,
  HStack,
  InputGroup,
  InputRightElement,
  useToast,
  Spinner
} from '@chakra-ui/react'
import { useEffect } from 'react'

export default function Login({ onAuth }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function submit(e) {
    e.preventDefault()
    if (!username || !password) {
      toast({ title: 'Missing fields', description: 'Please enter username and password', status: 'warning', duration: 3000 })
      return
    }
    try {
      setLoading(true)
      const url = isRegister ? '/auth/register' : '/auth/login'
      const resp = await API.post(url, isRegister ? { username, password, displayName } : { username, password })
      const { token, user } = resp.data
      toast({ title: 'Success', description: `${isRegister ? 'Registered' : 'Logged in'} as ${user.username}`, status: 'success', duration: 2000 })
      onAuth(token, user)
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Request failed'
      toast({ title: 'Error', description: message, status: 'error', duration: 4000 })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    function handleMessage(e) {
      try {
        const origin = window.location.origin
        // only accept messages from frontend origin
        if (e.origin !== origin) return
        const { token, user } = e.data || {}
        if (token) {
          onAuth(token, user)
        }
      } catch (err) {
        console.error('OAuth message error', err)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onAuth])

  function openOAuth(provider) {
    const url = `${API.defaults.baseURL}/auth/${provider}?popup=1`
    const popup = window.open(url, 'oauth', 'width=500,height=600')
    if (!popup) {
      toast({ title: 'Popup blocked', description: 'Please allow popups for this site', status: 'warning', duration: 3000 })
      return
    }
  }

  return (
    <Box maxW="md" mx="auto" mt={8} p={6} borderWidth={1} borderRadius="lg" boxShadow="sm" bg="white">
      <VStack spacing={4} align="stretch">
        <Heading size="md" textAlign="center">{isRegister ? 'Create an account' : 'Welcome back'}</Heading>

        <form onSubmit={submit}>
          <VStack spacing={3} align="stretch">
            <FormControl>
              <FormLabel>Username</FormLabel>
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="your username" />
            </FormControl>

            <FormControl>
              <FormLabel>Password</FormLabel>
              <InputGroup>
                <Input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="password" />
                <InputRightElement width="4.5rem">
                  <Button size="sm" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</Button>
                </InputRightElement>
              </InputGroup>
            </FormControl>

            {isRegister && (
              <FormControl>
                <FormLabel>Display name (optional)</FormLabel>
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="How people will see you" />
              </FormControl>
            )}

            <HStack justify="space-between" mt={2}>
              <Button colorScheme="blue" type="submit" disabled={loading}>
                {loading ? <><Spinner size="sm" mr={2} />{isRegister ? 'Registering' : 'Signing in'}</> : (isRegister ? 'Register' : 'Sign in')}
              </Button>
              <Button variant="ghost" onClick={() => setIsRegister(!isRegister)}>
                {isRegister ? 'Have an account? Sign in' : 'New here? Register'}
              </Button>
            </HStack>
          </VStack>
        </form>

        <HStack spacing={3} justify="center">
          <Button onClick={() => openOAuth('google')} colorScheme="red">Sign in with Google</Button>
        </HStack>

        <Text fontSize="sm" color="gray.500" textAlign="center">This is a demo. Use unique usernames for testing.</Text>
      </VStack>
    </Box>
  )
}
