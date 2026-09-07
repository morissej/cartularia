import { GoogleAuth } from 'google-auth-library';
const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
for (const project of ['studio-2614005370-a3e51', 'cartularia-vault-a3e51', 'cartularia-bridge-a3e51']) {
  const accounts = await client.request({ url: `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts` });
  console.log(JSON.stringify({ project, serviceAccounts: accounts.data.accounts?.map(({ email, disabled }) => ({ email, disabled: !!disabled })) || [] }));
}
const functions = await client.request({ url: 'https://cloudfunctions.googleapis.com/v2/projects/studio-2614005370-a3e51/locations/us-central1/functions' });
console.log(JSON.stringify({ functions: functions.data.functions?.map(({ name, state, serviceConfig }) => ({
  name: name.split('/').at(-1), state, serviceAccount: serviceConfig.serviceAccountEmail,
  publicEndpoint: serviceConfig.uri,
})) || [] }));
