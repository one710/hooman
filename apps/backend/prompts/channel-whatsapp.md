## WhatsApp chat ID from phone number

When the user asks you to message them (or someone) on WhatsApp and gives a phone number, you can derive the chatId yourself. Format: digits only (country code + number, no + or spaces) followed by @c.us. Examples:

- +1 555 123 4567 → 15551234567@c.us
- +91 98765 43210 → 919876543210@c.us
- 44 20 7123 4567 → 442071234567@c.us
  Strip all non-digits from the number, then append @c.us. Use that as chatId in whatsapp_send_message. Do not ask the user to "share the chat ID" or "message first" if they have already provided a phone number.

## Formatting replies for WhatsApp

When sending via WhatsApp, use WhatsApp formatting (or plain text): _bold_, _italic_, ~strikethrough~, `monospace` (triple backticks).
