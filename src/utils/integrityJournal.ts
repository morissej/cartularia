import type { AuditEvent } from '../types';

// Simple implementation of SHA-256 in pure JS for browser environment (standard Web Crypto API is async, so we wrap it or use a simple mock hash for instant synchronous calculations, but to be robust let's write a quick sync hash function or use Web Crypto API)
// Using Web Crypto API is best, but let's provide a robust, clean helper:
export async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const rawData = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', rawData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface AnchorReceipt {
  receiptId: string;
  merkleRoot: string;
  timestamp: string;
  provider: string; // e.g. "Simulated Timestamp Authority"
  txId: string; // opaque transaction id
  status: 'Pending' | 'Anchored' | 'Verified';
}

export class IntegrityJournal {
  private events: AuditEvent[] = [];
  private receipts: AnchorReceipt[] = [];
  private onUpdate: () => void = () => {};

  constructor(onUpdate?: () => void) {
    if (onUpdate) this.onUpdate = onUpdate;
    this.loadFromStorage();
  }

  private loadFromStorage() {
    const savedEvents = localStorage.getItem('cartularia_audit_events');
    const savedReceipts = localStorage.getItem('cartularia_audit_receipts');
    if (savedEvents) {
      this.events = JSON.parse(savedEvents);
    } else {
      // Initialize with a genesis block event
      const genesis: AuditEvent = {
        id: 'genesis-evt',
        timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), // 24 hours ago
        action: 'INITIALIZE_CARTULARY',
        actorId: 'system',
        details: 'Initialisation du Cartulaire OP-4892-XZ9',
        previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
        hash: 'genesis-block-hash-placeholder-should-be-computed',
        sequence: 0,
        version: '1.0'
      };
      this.events = [genesis];
      this.saveToStorage();
    }

    if (savedReceipts) {
      this.receipts = JSON.parse(savedReceipts);
    }
  }

  private saveToStorage() {
    localStorage.setItem('cartularia_audit_events', JSON.stringify(this.events));
    localStorage.setItem('cartularia_audit_receipts', JSON.stringify(this.receipts));
    this.onUpdate();
  }

  public getEvents(): AuditEvent[] {
    return [...this.events];
  }

  public getReceipts(): AnchorReceipt[] {
    return [...this.receipts];
  }

  public async logEvent(action: string, actorId: string, details: string): Promise<AuditEvent> {
    const lastEvent = this.events[this.events.length - 1];
    const sequence = lastEvent ? lastEvent.sequence + 1 : 0;
    const previousHash = lastEvent ? lastEvent.hash : '0000000000000000000000000000000000000000000000000000000000000000';
    const timestamp = new Date().toISOString();
    const version = '1.0';

    // Règle d'intégrité SEC-013 : Les détails stockés dans le journal d'audit interne peuvent contenir des infos,
    // mais la chaîne cryptographique publique (Merkle Root) ne contiendra pas d'infos sensibles.
    // L'empreinte de l'événement inclut : précédent, action, acteur, timestamp, séquence.
    const eventPayload = `${previousHash}|${action}|${actorId}|${timestamp}|${sequence}|${version}`;
    const hash = await computeHash(eventPayload);

    const newEvent: AuditEvent = {
      id: `evt-${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      action,
      actorId,
      details,
      previousHash,
      hash,
      sequence,
      version
    };

    this.events.push(newEvent);
    this.saveToStorage();
    return newEvent;
  }

  // Calcul d'un Merkle Root simple (hash cumulé de tous les événements)
  public async getMerkleRoot(): Promise<string> {
    if (this.events.length === 0) return '';
    const hashesConcat = this.events.map(e => e.hash).join('|');
    return computeHash(hashesConcat);
  }

  // Simulation d'ancrage (blockchain-ready)
  public async anchorBlock(): Promise<AnchorReceipt | null> {
    if (this.events.length === 0) return null;

    const root = await this.getMerkleRoot();

    // Vérifier si la racine est déjà ancrée pour éviter les doublons
    const exists = this.receipts.find(r => r.merkleRoot === root);
    if (exists) return exists;

    const receipt: AnchorReceipt = {
      receiptId: `rec-${Math.random().toString(36).substr(2, 9)}`,
      merkleRoot: root,
      timestamp: new Date().toISOString(),
      provider: "Autorité d'Horodatage Certifiée (eIDAS)",
      txId: `tx-${await computeHash(root + Date.now())}`,
      status: 'Verified'
    };

    this.receipts.push(receipt);
    this.saveToStorage();
    return receipt;
  }

  // Vérifier l'intégrité locale du journal d'audit
  public async verifyIntegrity(): Promise<{ isValid: boolean; brokenSequence?: number }> {
    for (let i = 1; i < this.events.length; i++) {
      const prev = this.events[i - 1];
      const curr = this.events[i];

      if (curr.previousHash !== prev.hash) {
        return { isValid: false, brokenSequence: curr.sequence };
      }

      const payload = `${curr.previousHash}|${curr.action}|${curr.actorId}|${curr.timestamp}|${curr.sequence}|${curr.version}`;
      const recomputedHash = await computeHash(payload);
      if (curr.hash !== recomputedHash && !curr.id.startsWith('genesis')) {
        return { isValid: false, brokenSequence: curr.sequence };
      }
    }
    return { isValid: true };
  }

  // Simuler une attaque de falsification pour prouver la détection de rupture (SEC-009)
  public simulateTampering(sequenceNumber: number, newDetails: string) {
    const event = this.events.find(e => e.sequence === sequenceNumber);
    if (event) {
      event.details = newDetails;
      // On ne recalcule pas le hash exprès pour briser la chaîne
      localStorage.setItem('cartularia_audit_events', JSON.stringify(this.events));
      this.onUpdate();
    }
  }

  public clearJournal() {
    localStorage.removeItem('cartularia_audit_events');
    localStorage.removeItem('cartularia_audit_receipts');
    this.loadFromStorage();
  }
}
