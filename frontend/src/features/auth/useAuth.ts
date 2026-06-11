import { useState, useEffect } from 'react'
import type { ProfileUser } from '@/types'

type UserRole = 'Guest' | 'Free' | 'Pro' | 'VIP' | 'Admin'

const ROLE_KEY = 'procluster_user_role'
const PROFILE_KEY = 'procluster_profile_user'

export function useAuth() {
  const [userRole, setUserRoleState] = useState<UserRole>(() => {
    const stored = localStorage.getItem(ROLE_KEY)
    return (stored as UserRole) || 'Guest'
  })

  const [profileUser, setProfileUser] = useState<ProfileUser | null>(() => {
    try {
      const stored = localStorage.getItem(PROFILE_KEY)
      return stored ? JSON.parse(stored) as ProfileUser : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    localStorage.setItem(ROLE_KEY, userRole)
  }, [userRole])

  useEffect(() => {
    if (profileUser) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profileUser))
    }
  }, [profileUser])

  const handleUserRoleChange = (role: UserRole) => {
    setUserRoleState(role)
  }

  const handleProfileUpdate = (updates: Partial<ProfileUser>) => {
    setProfileUser(prev => prev ? { ...prev, ...updates } : null)
  }

  return { userRole, profileUser, handleUserRoleChange, handleProfileUpdate }
}
