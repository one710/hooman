/**
 * In-memory store for WhatsApp connection state (QR + status + self identity) so the API can serve it to the
 * frontend. The WhatsApp worker POSTs updates here via /api/internal/whatsapp-connection.
 */
export type WhatsAppConnectionStatus = "disconnected" | "pairing" | "connected";

let status: WhatsAppConnectionStatus = "disconnected";
let qr: string | undefined;
/** Logged-in user ID (e.g. 1234567890@c.us) and optional display number for "Connected as +1…". */
let selfId: string | undefined;
let selfNumber: string | undefined;

export function getWhatsAppConnection(): {
  status: WhatsAppConnectionStatus;
  qr?: string;
  /** Current user's WhatsApp ID (set when connected). */
  selfId?: string;
  /** Current user's number for display (e.g. +1234567890). */
  selfNumber?: string;
} {
  return { status, qr, selfId, selfNumber };
}

export function setWhatsAppConnection(update: {
  status: WhatsAppConnectionStatus;
  qr?: string;
  selfId?: string;
  selfNumber?: string;
}): void {
  status = update.status;
  qr = update.status === "pairing" ? update.qr : undefined;
  if (update.status === "connected") {
    selfId = update.selfId;
    selfNumber = update.selfNumber;
  } else {
    selfId = undefined;
    selfNumber = undefined;
  }
}
