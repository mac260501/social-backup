# Security Documentation

## Overview

This document outlines the security measures implemented in the Social Backup application.

## Authentication & Authorization

### Authentication
- Uses NextAuth.js with Twitter OAuth 2.0 provider
- Session-based authentication
- All API routes verify authentication before processing requests

### Authorization
- **Ownership verification**: Users can only access their own resources
- All API routes check that the authenticated user owns the requested resource
- Security warnings logged for unauthorized access attempts

## API Security

### Protected Endpoints

All API endpoints implement the following security measures:

#### 1. `/api/backups` (GET)
- ✅ Authentication check via NextAuth session
- ✅ Verifies requested userId matches authenticated user
- ✅ Returns only backups belonging to the authenticated user
- ❌ Prevents users from accessing other users' backups

#### 2. `/api/backups/delete` (DELETE)
- ✅ Authentication check via NextAuth session
- ✅ Ownership verification - verifies user owns the backup before deletion
- ✅ Secure media cleanup - only deletes orphaned files
- ❌ Prevents users from deleting other users' backups

#### 3. `/api/media` (GET)
- ✅ Authentication check via NextAuth session
- ✅ Ownership verification - verifies user owns the backup before returning media
- ❌ Prevents users from accessing other users' media files

### Security Helpers

Located in `/lib/auth-helpers.ts`:

```typescript
// Verify backup ownership
verifyBackupOwnership(backupId, userId): Promise<boolean>

// Verify media ownership (via backup)
verifyMediaOwnership(backupId, userId): Promise<boolean>

// Generate UUID from string
createUuidFromString(str): string
```

## Supabase Storage Security

### RLS Policies
The `twitter-media` bucket has Row Level Security policies:

1. **Upload**: Users can upload their own media (INSERT)
2. **View**: Users can view their own media (SELECT)
3. **Delete**: Users can delete their own media (DELETE)

### Service Role Usage
- API routes use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS
- **Why**: Allows server-side operations while maintaining security
- **How it's safe**: API routes manually verify ownership before operations
- **Result**: Storage policies + API authorization = Defense in depth

### Storage Path Structure
Media files stored at: `{userId}/{mediaType}/{fileName}`
- userId: SHA-256 hash-based UUID from Twitter user ID
- mediaType: tweets_media, profile_media, etc.
- fileName: Original filename from archive

## Data Privacy

### User Isolation
- Each user's data is isolated by user_id
- Database queries always filter by authenticated user's ID
- Storage paths include user ID for namespace isolation

### Media File Sharing Prevention
- Media files cannot be accessed without owning the parent backup
- Direct storage URLs are not exposed to unauthorized users
- All media access goes through authenticated API routes

## Security Best Practices

### For Developers

1. **Always verify session**:
   ```typescript
   const session = await getServerSession(authOptions)
   if (!session || !session.user?.id) {
     return unauthorized()
   }
   ```

2. **Always verify ownership**:
   ```typescript
   const isOwner = await verifyBackupOwnership(backupId, session.user.id)
   if (!isOwner) {
     return forbidden()
   }
   ```

3. **Log security warnings**:
   ```typescript
   console.warn(`[Security] User ${userId} attempted unauthorized action`)
   ```

4. **Never trust client input**:
   - Always validate against session
   - Never use client-provided userId without verification
   - Verify all resource ownership

### For Admins

1. **Environment Variables**: Keep service role key secret
2. **Monitoring**: Watch logs for `[Security]` warnings
3. **RLS Policies**: Keep Supabase Storage RLS policies enabled
4. **Regular Audits**: Review access logs periodically

## Threat Model

### Mitigated Threats ✅

1. **Unauthorized Data Access**: Users cannot access other users' backups or media
2. **Unauthorized Deletion**: Users cannot delete other users' backups
3. **IDOR (Insecure Direct Object Reference)**: All resources verified for ownership
4. **Session Hijacking**: Protected by NextAuth secure sessions
5. **Storage Bypass**: Storage access only through authenticated API

### Ongoing Considerations

1. **Rate Limiting**: Consider implementing for upload/delete operations
2. **Input Validation**: Add stricter validation for file uploads
3. **CSRF Protection**: NextAuth provides CSRF tokens automatically
4. **XSS**: Next.js escapes output by default

## Incident Response

If a security issue is discovered:

1. **Report**: Create a private security advisory on GitHub
2. **Fix**: Implement fix with security team review
3. **Test**: Verify fix doesn't break existing security
4. **Deploy**: Roll out fix with detailed changelog
5. **Notify**: Inform affected users if needed

## Security Checklist for New Features

Before deploying new features:

- [ ] Authentication check implemented
- [ ] Authorization/ownership check implemented
- [ ] Input validation added
- [ ] Security logging added
- [ ] Error messages don't leak sensitive info
- [ ] RLS policies reviewed
- [ ] Code reviewed by second developer

## References

- [NextAuth.js Security](https://next-auth.js.org/configuration/options#security)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
