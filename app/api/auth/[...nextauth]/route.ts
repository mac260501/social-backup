import NextAuth from "next-auth"
import TwitterProvider from "next-auth/providers/twitter"
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const handler = NextAuth({
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
      version: "2.0",
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Save user to Supabase when they sign in
      if (account && profile) {
        const { error } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            twitter_username: profile.data?.username,
            twitter_user_id: profile.data?.id,
            updated_at: new Date().toISOString(),
          })
        
        if (error) {
          console.error('Error saving user:', error)
        }
      }
      return true
    },
    async session({ session, token }) {
      if (token.username) {
        session.user.username = token.username
      }
      if (token.sub) {
        session.user.id = token.sub
      }
      return session
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.username = profile.data?.username
        token.accessToken = account.access_token
      }
      return token
    },
  },
})

export { handler as GET, handler as POST }