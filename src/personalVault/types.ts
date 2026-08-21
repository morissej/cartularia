import { generateCorrespondenceCode } from '../domain/correspondenceCodes.ts';
import type { OwnerField, OwnerType } from '../features/cartulary/state/cartularyStateTypes.ts';

export interface PersonalOwnerProfile {
  id: string;
  clientNumber: string;
  linkedToUserName: boolean;
  label: string;
  type: OwnerType;
  fields: OwnerField[];
  objectCodes: string[];
}

export interface PersonalTransmissionPlan {
  id: string;
  transmissionCode: string;
  name: string;
  notes: string;
  recipients: PersonalTransmissionRecipient[];
}

export interface PersonalTransmissionRecipient {
  id: string;
  recipientCode: string;
  firstName: string;
  lastName: string;
  address: string;
  email: string;
  phone: string;
}

export interface PersonalStorageLocation {
  id: string;
  locationCode: string;
  codeName: string;
  preciseLocation: string;
  contents: string;
  securityAndConditions: string;
}

export interface PersonalManager {
  id: string;
  managerCode: string;
  firstName: string;
  lastName: string;
  address: string;
  email: string;
  phone: string;
  role: string;
}

export interface PersonalVaultPayload {
  schemaVersion: 'personal-vault@3.0.0';
  userName: string;
  owners: PersonalOwnerProfile[];
  transmissionPlans: PersonalTransmissionPlan[];
  storage: PersonalStorageLocation[];
  managers: PersonalManager[];
  updatedAt: string;
}

export const createEmptyOwnerProfile = (id: string, linkedToUserName = false): PersonalOwnerProfile => ({
  id,
  clientNumber: generateCorrespondenceCode('client'),
  linkedToUserName,
  label: 'Propriétaire principal',
  type: 'Personne physique',
  objectCodes: [],
  fields: [
    { id: `${id}-last-name`, label: 'Nom', value: '' },
    { id: `${id}-first-name`, label: 'Prénom', value: '' },
    { id: `${id}-address`, label: 'Adresse', value: '' },
    { id: `${id}-email`, label: 'Email', value: '' },
    { id: `${id}-phone`, label: 'Téléphone', value: '' },
  ],
});

export const createEmptyTransmissionPlan = (id: string): PersonalTransmissionPlan => ({
  id,
  transmissionCode: generateCorrespondenceCode('transmission'),
  name: 'Plan de transmission',
  notes: '',
  recipients: [],
});

export const createEmptyStorageLocation = (id: string): PersonalStorageLocation => ({
  id,
  locationCode: generateCorrespondenceCode('location'),
  codeName: '',
  preciseLocation: '',
  contents: '',
  securityAndConditions: '',
});

export const createEmptyManager = (id: string): PersonalManager => ({
  id,
  managerCode: generateCorrespondenceCode('manager'),
  firstName: '',
  lastName: '',
  address: '',
  email: '',
  phone: '',
  role: '',
});

export const emptyPersonalVaultPayload = (userName: string): PersonalVaultPayload => ({
  schemaVersion: 'personal-vault@3.0.0',
  userName,
  owners: [createEmptyOwnerProfile('owner-primary', true)],
  transmissionPlans: [],
  storage: [],
  managers: [],
  updatedAt: new Date().toISOString(),
});

type LegacyPayload = Partial<PersonalVaultPayload> & {
  schemaVersion?: string;
  userAlias?: string;
  userName?: string;
  managers?: PersonalManager[];
};

export const migratePersonalVaultPayload = (value: LegacyPayload, userName: string): PersonalVaultPayload => {
  const legacyOwners = Array.isArray(value.owners) ? value.owners : [];
  const owners = legacyOwners.length > 0 ? legacyOwners.map((owner, index) => ({
    ...owner,
    clientNumber: owner.clientNumber || generateCorrespondenceCode('client'),
    linkedToUserName: index === 0,
    objectCodes: Array.isArray(owner.objectCodes) ? owner.objectCodes : [],
  })) : [createEmptyOwnerProfile('owner-primary', true)];
  const plans = (Array.isArray(value.transmissionPlans) ? value.transmissionPlans : []).map((plan) => ({
    id: plan.id,
    transmissionCode: plan.transmissionCode || generateCorrespondenceCode('transmission'),
    name: plan.name,
    notes: plan.notes,
    recipients: (Array.isArray(plan.recipients) ? plan.recipients : []).map((recipient) => ({
      id: recipient.id,
      recipientCode: recipient.recipientCode || generateCorrespondenceCode('person'),
      firstName: recipient.firstName,
      lastName: recipient.lastName,
      address: recipient.address,
      email: recipient.email,
      phone: recipient.phone,
    })),
  }));
  const storage = (Array.isArray(value.storage) ? value.storage : []).map((location) => ({
    id: location.id,
    locationCode: location.locationCode || generateCorrespondenceCode('location'),
    codeName: location.codeName,
    preciseLocation: location.preciseLocation,
    contents: location.contents,
    securityAndConditions: location.securityAndConditions,
  }));
  return {
    schemaVersion: 'personal-vault@3.0.0',
    userName: value.userName || value.userAlias || userName,
    owners,
    transmissionPlans: plans,
    storage,
    managers: (Array.isArray(value.managers) ? value.managers : []).map((manager) => ({
      ...manager,
      managerCode: manager.managerCode || generateCorrespondenceCode('manager'),
    })),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
};
