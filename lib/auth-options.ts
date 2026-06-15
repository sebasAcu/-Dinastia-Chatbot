import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Password',
      credentials: {
        password: { label: 'Contraseña', type: 'password' }
      },
      async authorize(credentials) {
        if (credentials?.password === process.env.DASHBOARD_PASSWORD) {
          return { id: '1', name: 'Admin', email: 'admin@dinastia.app' }
        }
        return null
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: '/login' },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60
  }
}
