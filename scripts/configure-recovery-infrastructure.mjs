import { GoogleAuth } from 'google-auth-library';
const apply = process.argv.includes('--apply');
const registry = 'studio-2614005370-a3e51';
const targets = [registry, 'cartularia-vault-a3e51', 'cartularia-bridge-a3e51'];
const runner = `cartularia-recovery-runner@${registry}.iam.gserviceaccount.com`;
const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const request = async (url, method = 'GET', data) => (await client.request({ url, method, data })).data;
const ensureAccount = async (project, accountId) => {
  const email = `${accountId}@${project}.iam.gserviceaccount.com`;
  const path = `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${email}`;
  try { await request(path); }
  catch (error) {
    if (error.response?.status !== 404) throw error;
    if (!apply) { console.log(JSON.stringify({ planned: 'create-service-account', email })); return email; }
    await request(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`, 'POST', { accountId, serviceAccount: { displayName: 'Cartularia recovery — scoped runtime/signing' } });
  }
  return email;
};
const rolePermissions = (project) => [
  'firebaseauth.users.get',
  ...(project.endsWith('bridge-a3e51') ? [] : ['datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update', 'datastore.databases.get']),
];
const bind = async (base, role, member) => {
  const policy = await request(`${base}:getIamPolicy`, 'POST', {});
  const bindings = [...(policy.bindings || [])].map((binding) => ({ ...binding, members: [...(binding.members || [])] }));
  let binding = bindings.find((item) => item.role === role && !item.condition);
  if (binding?.members.includes(member)) return;
  if (!apply) { console.log(JSON.stringify({ planned: 'add-binding', resource: base, role, member })); return; }
  if (!binding) { binding = { role, members: [] }; bindings.push(binding); }
  binding.members.push(member);
  await request(`${base}:setIamPolicy`, 'POST', { policy: { ...policy, bindings }, updateMask: 'bindings,etag' });
};
await ensureAccount(registry, 'cartularia-recovery-runner');
for (const project of targets) {
  const roleId = 'cartulariaRecoveryRuntime';
  const roleName = `projects/${project}/roles/${roleId}`;
  const role = { title: 'Cartularia recovery runtime', description: 'Account status and entity access required by recovery. Document paths are limited in application code, not by IAM. No entity delete or Auth password-update permission.', includedPermissions: rolePermissions(project), stage: 'GA' };
  let existing;
  try { existing = await request(`https://iam.googleapis.com/v1/${roleName}`); }
  catch (error) { if (error.response?.status !== 404) throw error; }
  if (!existing) {
    if (apply) await request(`https://iam.googleapis.com/v1/projects/${project}/roles`, 'POST', { roleId, role });
    else console.log(JSON.stringify({ planned: 'create-role', roleName, permissions: role.includedPermissions }));
  } else if (JSON.stringify([...existing.includedPermissions].sort()) !== JSON.stringify([...role.includedPermissions].sort())) {
    throw new Error(`Existing custom role differs; inspect before changing: ${roleName}`);
  }
  if (apply || existing) await bind(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`, roleName, `serviceAccount:${runner}`);
  else console.log(JSON.stringify({ planned: 'add-binding-after-role-creation', project, role: roleName, member: `serviceAccount:${runner}` }));
  const signer = project === registry ? runner : await ensureAccount(project, 'cartularia-recovery-signer');
  if (apply) await bind(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${signer}`, 'roles/iam.serviceAccountTokenCreator', `serviceAccount:${runner}`);
  else console.log(JSON.stringify({ planned: 'signer-binding', signer, member: runner }));
}
if (apply) await bind(`https://cloudresourcemanager.googleapis.com/v1/projects/${registry}`, 'roles/logging.logWriter', `serviceAccount:${runner}`);
console.log(JSON.stringify({ applied: apply, runner, scope: targets }));
