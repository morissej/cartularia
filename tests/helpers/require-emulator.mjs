export const requireEmulatorEndpoint = (environmentVariable) => {
  const value = process.env[environmentVariable];
  if (!value) {
    throw new Error(`${environmentVariable} absent : cette suite exige un émulateur Firebase lancé.`);
  }
  const separator = value.lastIndexOf(':');
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (separator <= 0 || !host || !Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${environmentVariable} invalide : hôte et port explicites attendus.`);
  }
  return { host, port };
};
