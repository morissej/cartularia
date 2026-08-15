import React, { useCallback, useState, useEffect } from 'react';
import { IntegrityJournal } from '../utils/integrityJournal';
import type { AnchorReceipt } from '../utils/integrityJournal';
import type { AuditEvent } from '../types';
import { Check, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

interface AuditPanelProps {
  journal: IntegrityJournal;
  language: 'FR' | 'EN';
  sealHash?: string;
  sealSupportCode?: string;
}

export const AuditPanel: React.FC<AuditPanelProps> = ({
  journal,
  language,
  sealHash = 'EA3B2D1C9F8E...',
  sealSupportCode = '5489-210-987-XZ9'
}) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [receipts, setReceipts] = useState<AnchorReceipt[]>([]);
  const [integrityStatus, setIntegrityStatus] = useState<{ isValid: boolean; brokenSequence?: number }>({ isValid: true });


  // Onglet technique masqué par défaut (Règle 4)
  const [showTechnicalSim, setShowTechnicalSim] = useState(false);

  const refreshJournal = useCallback(async () => {
    setEvents(journal.getEvents());
    setReceipts(journal.getReceipts());
    const status = await journal.verifyIntegrity();
    setIntegrityStatus(status);
  }, [journal]);

  useEffect(() => {
    refreshJournal();
  }, [refreshJournal]);

  const handleTimestamp = async () => {
    await journal.timestampBatch();
    await refreshJournal();
  };

  const handleTamper = async (seq: number) => {
    journal.simulateTampering(seq, "FALSIFICATION : Prix d'achat modifié à 15 000 EUR");
    await refreshJournal();
  };

  const handleReset = async () => {
    journal.clearJournal();
    await refreshJournal();
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--s4)',
      padding: 'var(--s4)',
      height: '100%',
      overflowY: 'auto',
      backgroundColor: 'var(--sheet)',
      color: 'var(--ink)'
    }}>
      {/* 1. Couche de Confiance / Sceau */}
      <div style={{
        borderBottom: '1px solid var(--rule)',
        paddingBottom: 'var(--s4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--s2)' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: integrityStatus.isValid ? 'var(--ink)' : 'var(--mark)',
          }} />
          <h4 style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}>
            {language === 'FR' ? "Preuve d'intégrité" : "Integrity Proof"}
          </h4>
        </div>

        {/* Détails du Sceau compacts (Règle 3) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? "Statut Sceau" : "Seal Status"}</span>
            <span style={{ fontWeight: 600, color: integrityStatus.isValid ? 'var(--ink)' : 'var(--mark)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {integrityStatus.isValid ? <Check size={12} /> : <AlertTriangle size={12} />}
              {integrityStatus.isValid
                ? (language === 'FR' ? "Chaîne locale cohérente" : "Local chain consistent")
                : (language === 'FR' ? "Rupture détectée" : "Break detected")}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? "Portée du contrôle" : "Verification scope"}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{language === 'FR' ? 'Session locale' : 'Local session'}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--s1)' }}>
            <span style={{ color: 'var(--muted)', fontSize: '11px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              {language === 'FR' ? "Empreinte SHA-256 (Abrégée)" : "SHA-256 Hash (Short)"}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              backgroundColor: 'var(--paper)',
              padding: '6px var(--s2)',
              border: '1px solid var(--rule)',
              wordBreak: 'break-all'
            }}>
              {sealHash.substring(0, 16)}...
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'center', marginTop: 'var(--s1)' }}>
            <span style={{ color: 'var(--muted)' }}>{language === 'FR' ? "Code de Support" : "Support Code"}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{sealSupportCode}</span>
          </div>
        </div>

        {/* QR Code de Partage en petit dans les détails (Règle 3) */}
        <div style={{
          marginTop: 'var(--s3)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s3)',
          backgroundColor: 'var(--paper)',
          padding: 'var(--s3)',
          border: '1px solid var(--rule)'
        }}>
          {/* Mock QR mini */}
          <div style={{
            width: '64px',
            height: '64px',
            backgroundColor: '#FFFFFF',
            border: '1px solid var(--ink)',
            padding: '4px',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              backgroundImage: 'radial-gradient(var(--ink) 25%, transparent 25%), radial-gradient(var(--ink) 25%, transparent 25%)',
              backgroundSize: '6px 6px',
              backgroundPosition: '0 0, 3px 3px',
              opacity: 0.8
            }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
              {language === 'FR' ? "QR CODE DE PARTAGE" : "SHARE QR CODE"}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
              {language === 'FR' ? "Scannez pour ouvrir la fiche publique." : "Scan to open the public record."}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Journal d'Audit Châné */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        <h4 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em'
        }}>
          {language === 'FR' ? "Journal d'intégrité" : "Integrity Journal"}
        </h4>

        {/* Alerte de rupture */}
        {!integrityStatus.isValid && (
          <div style={{
            backgroundColor: 'rgba(166, 58, 42, 0.08)',
            border: '1px solid var(--mark)',
            padding: 'var(--s2) var(--s3)',
            color: 'var(--mark)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <AlertTriangle size={14} />
            <span>
              {language === 'FR'
                ? `Rupture de chaîne à la séquence #${integrityStatus.brokenSequence} !`
                : `Chain broken at sequence #${integrityStatus.brokenSequence}!`}
            </span>
          </div>
        )}

        {/* Événements */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '300px',
          overflowY: 'auto',
          paddingRight: '4px'
        }}>
          {events.map((evt) => {
            const isBroken = !integrityStatus.isValid && integrityStatus.brokenSequence === evt.sequence;
            return (
              <div key={evt.id} style={{
                padding: 'var(--s2)',
                backgroundColor: isBroken ? 'rgba(166, 58, 42, 0.04)' : 'var(--paper)',
                borderLeft: `2px solid ${isBroken ? 'var(--mark)' : 'var(--rule)'}`,
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: '9px' }}>
                  <span>#{evt.sequence} · {evt.action}</span>
                  <span className="tabular-nums">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                </div>
                <div style={{ fontWeight: 500, color: 'var(--ink)' }}>
                  {evt.details}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--muted)', marginTop: '2px' }}>
                  HASH: <span className="tabular-nums" style={{ color: isBroken ? 'var(--mark)' : 'var(--muted)' }}>{evt.hash.substring(0, 12)}...</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reçus d'horodatage local de test */}
        {receipts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--s1)' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {language === 'FR' ? "Reçus d’horodatage de test" : "Test timestamp receipts"}
            </span>
            {receipts.map((rec) => (
              <div key={rec.receiptId} style={{
                backgroundColor: 'var(--fill)',
                padding: 'var(--s2)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span style={{ fontSize: '10px' }}>{rec.provider}</span>
                  <span style={{ color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '2px', fontSize: '9px' }}>
                    <Check size={8} /> {language === 'FR' ? 'NON QUALIFIÉ' : 'NON-QUALIFIED'}
                  </span>
                </div>
                <div style={{ fontSize: '8px', color: 'var(--muted)', wordBreak: 'break-all' }}>
                  ROOT: {rec.merkleRoot.substring(0, 24)}...
                </div>
                <div style={{ fontSize: '8px', color: 'var(--muted)' }}>
                  {language === 'FR' ? 'Ancrage public : différé' : 'Public anchoring: deferred'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Tiroir de Simulation Technique (Masqué par défaut - Règle 4) */}
      <div style={{
        borderTop: '1px solid var(--rule)',
        paddingTop: 'var(--s3)',
        marginTop: 'auto'
      }}>
        <button
          onClick={() => setShowTechnicalSim(!showTechnicalSim)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: 'var(--s2) 0',
            cursor: 'pointer'
          }}
        >
          <span>{language === 'FR' ? "⚡ Simulation technique" : "⚡ Technical Simulation"}</span>
          {showTechnicalSim ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showTechnicalSim && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s2)',
            backgroundColor: 'var(--paper)',
            padding: 'var(--s3)',
            marginTop: 'var(--s1)',
            border: '1px solid var(--rule)'
          }}>
            <p style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: 'var(--s1)' }}>
              {language === 'FR'
                ? "Simulation locale : testez la détection d’une altération et créez un reçu non qualifié. Aucun ancrage public n’est effectué."
                : "Local simulation: test tamper detection and create a non-qualified receipt. No public anchoring is performed."}
            </p>
            <div style={{ display: 'flex', gap: 'var(--s2)' }}>
              {integrityStatus.isValid && events.length > 1 ? (
                <button
                  onClick={() => handleTamper(events[1].sequence)}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    border: '1px solid var(--mark)',
                    color: 'var(--mark)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  {language === 'FR' ? "Falsifier Événement #1" : "Tamper Event #1"}
                </button>
              ) : (
                <button
                  onClick={handleReset}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    border: '1px solid var(--ink)',
                    color: 'var(--ink)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  {language === 'FR' ? "Restaurer l'Intégrité" : "Restore Integrity"}
                </button>
              )}

              <button
                onClick={handleTimestamp}
                disabled={!integrityStatus.isValid}
                style={{
                  backgroundColor: integrityStatus.isValid ? 'var(--ink)' : 'var(--fill)',
                  color: integrityStatus.isValid ? 'var(--paper)' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '8px 12px',
                  cursor: integrityStatus.isValid ? 'pointer' : 'not-allowed',
                  transition: 'var(--transition)'
                }}
              >
                {language === 'FR' ? "Horodater le lot" : "Timestamp Batch"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
