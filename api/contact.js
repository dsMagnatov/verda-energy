import { handleContact } from '../worker/contact-api.js';
import { createContactStore } from '../server/contact-store.js';

export default {
  fetch(request) {
    // Public intake is preserved. Private messages remain in the owner's
    // Vercel Blob store; client-provided Sites identity never grants access.
    return handleContact(request, { BUCKET: createContactStore() });
  },
};
