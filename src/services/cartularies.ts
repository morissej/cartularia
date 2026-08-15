import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { CartularyEnvelope, CartularySectionDocument } from '../domain/cartulary.ts';

export interface PrivateCartularySnapshot {
  envelope: CartularyEnvelope;
  sections: CartularySectionDocument[];
}

export const loadPrivateCartulary = async (cartularyId: string): Promise<PrivateCartularySnapshot | null> => {
  const cartularyRef = doc(db, 'cartularies', cartularyId);
  const envelopeSnapshot = await getDoc(cartularyRef);
  if (!envelopeSnapshot.exists()) return null;

  const sectionSnapshots = await getDocs(collection(cartularyRef, 'sections'));
  const sections = sectionSnapshots.docs
    .map((section) => section.data() as CartularySectionDocument)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return {
    envelope: envelopeSnapshot.data() as CartularyEnvelope,
    sections,
  };
};
