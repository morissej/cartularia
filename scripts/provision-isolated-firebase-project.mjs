import { GoogleAuth } from 'google-auth-library';

const flag = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};

const projectId = flag('--project');
const projectNumber = flag('--project-number');
const administrationServiceAccount = flag('--administration-service-account');
const allowRemote = process.argv.includes('--allow-remote');

if (!projectId || !projectNumber || !administrationServiceAccount) {
  throw new Error('Utilisation : --project <id> --project-number <numero> --administration-service-account <email>.');
}
if (!allowRemote) throw new Error('Provisionnement distant refusé sans --allow-remote.');
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Identifiant projet invalide.');
if (!/^\d{6,20}$/.test(projectNumber)) throw new Error('Numéro projet invalide.');
if (!administrationServiceAccount.endsWith('.gserviceaccount.com')) throw new Error('Compte de service invalide.');

const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const client = await googleAuth.getClient();
const accessToken = await client.getAccessToken();
if (!accessToken.token) throw new Error('Jeton Google Cloud indisponible.');

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${response.status} ${payload?.error?.message || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return payload;
};

const waitForIdentityToolkit = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const service = await request(
      `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/identitytoolkit.googleapis.com`,
    );
    if (service.state === 'ENABLED') return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Délai d’activation API dépassé.');
};

await request(
  `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/identitytoolkit.googleapis.com:enable`,
  { method: 'POST', body: '{}' },
);
await waitForIdentityToolkit();

try {
  await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`);
} catch (error) {
  if (error?.status !== 404) throw error;
  try {
    await request(
      `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/identityPlatform:initializeAuth`,
      { method: 'POST', body: '{}' },
    );
  } catch (initializeError) {
    if (initializeError?.status !== 409) throw initializeError;
  }
}

await request(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired,emailPrivacyConfig.enableImprovedEmailPrivacy`,
  {
    method: 'PATCH',
    body: JSON.stringify({
      signIn: { email: { enabled: true, passwordRequired: true } },
      emailPrivacyConfig: { enableImprovedEmailPrivacy: true },
    }),
  },
);

const resourceManagerBase = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`;
const policy = await request(`${resourceManagerBase}:getIamPolicy`, { method: 'POST', body: '{}' });
const member = `serviceAccount:${administrationServiceAccount}`;
const requiredRoles = ['roles/firebaseauth.admin', 'roles/datastore.viewer'];
const bindings = Array.isArray(policy.bindings) ? policy.bindings.map((binding) => ({
  ...binding,
  members: Array.isArray(binding.members) ? [...binding.members] : [],
})) : [];

for (const role of requiredRoles) {
  const binding = bindings.find((candidate) => candidate.role === role && !candidate.condition);
  if (binding) {
    if (!binding.members.includes(member)) binding.members.push(member);
  } else {
    bindings.push({ role, members: [member] });
  }
}

await request(`${resourceManagerBase}:setIamPolicy`, {
  method: 'POST',
  body: JSON.stringify({
    policy: { ...policy, bindings },
    updateMask: 'bindings,etag',
  }),
});

const [authConfig, verifiedPolicy] = await Promise.all([
  request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`),
  request(`${resourceManagerBase}:getIamPolicy`, { method: 'POST', body: '{}' }),
]);

console.log(JSON.stringify({
  projectId,
  emailPasswordEnabled: authConfig?.signIn?.email?.enabled === true,
  passwordRequired: authConfig?.signIn?.email?.passwordRequired === true,
  improvedEmailPrivacy: authConfig?.emailPrivacyConfig?.enableImprovedEmailPrivacy === true,
  administrationRoles: requiredRoles.filter((role) => verifiedPolicy.bindings?.some((binding) => (
    binding.role === role && binding.members?.includes(member)
  ))),
}, null, 2));
