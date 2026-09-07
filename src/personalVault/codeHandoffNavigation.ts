import { MAX_HANDOFF_FRAGMENT, type CodeHandoffReturn } from './codeHandoffProtocol';
export function returnCodesToRegistry(origin: string, packet: CodeHandoffReturn) {
  const fragment = encodeURIComponent(JSON.stringify(packet));
  if (fragment.length > MAX_HANDOFF_FRAGMENT) throw new Error('too-many-codes');
  const destination = new URL('/code-handoff-return', origin);
  destination.hash = fragment;
  window.location.replace(destination.toString());
}
