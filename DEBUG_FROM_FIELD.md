# Email From Field - Debug Session

## Problem
All emails being pulled are showing as missing a From line (displaying 'Unknown').

## JMAP Spec Guidance
From the JMAP RFC 5322 spec:
- Valid RFC 5322 emails **MUST** have a From header
- JMAP provides a `from` convenience property derived from `header:From`
- If the header is missing, `from` returns `null`
- To query for emails missing From: `NOT { "header": ["From"] }`

## Current Implementation

### Email/get Request (src/App.jsx:49-78)
```javascript
['Email/get', {
  '#ids': { resultOf: 'a', name: 'Email/query', path: '/ids' },
  properties: ['id', 'subject', 'from', 'receivedAt', 'preview', 'textBody', 'mailboxIds']
}, 'b']
```

**Status:** ✅ Correctly requesting `from` convenience property (most appropriate per JMAP spec)

### From Field Parsing (src/App.jsx:80-83)
```javascript
const classifyEmails = async (emailList) => {
  const emailTexts = emailList.map((email, idx) =>
    `Email ${idx}:\nFrom: ${email.from?.[0]?.email || 'Unknown'}\nSubject: ${email.subject}\nPreview: ${email.preview}`
  ).join('\n\n');
```

### From Field Display (src/App.jsx:634, 697)
```javascript
From: <span className="font-medium">{email.from?.[0]?.name || email.from?.[0]?.email || 'Unknown'}</span>
```

## Expected From Field Structure
From JMAP spec, `from` is an array of objects:
```javascript
from: [
  {
    name: 'Display Name',      // optional
    email: 'sender@example.com' // required
  }
]
```

## Root Cause Possibilities
1. ❓ Fastmail is not populating the `from` property for your emails
2. ❓ The `from` structure is different than expected
3. ❓ All emails genuinely lack From headers (unlikely)

## Debugging Recommendations
- Add logging to backend (server.js:70-107) to inspect raw Fastmail API response
- Log the actual response before it's returned to frontend
- Check if `from` property is null, undefined, or has unexpected structure
- Consider requesting both `from` AND `headers:From` to compare

## Next Step
Modify Email/get properties to also capture the raw header:
```javascript
properties: ['id', 'subject', 'from', 'receivedAt', 'preview', 'textBody', 'mailboxIds', 'headers:From']
```

This will help determine if the header exists but isn't being parsed into the `from` convenience property.
