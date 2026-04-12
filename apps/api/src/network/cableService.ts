import { getLab, updateLabDocument } from "../labs/labStore.js";
import { removeNetwork } from "../topology/mutations.js";

export async function deleteCable(labId: string, networkId: string) {
  const lab = await getLab(labId);
  if (!lab) {
    return null;
  }

  const network = lab.document.networks.find((entry) => entry.id === networkId);
  if (!network) {
    return null;
  }

  return updateLabDocument(labId, removeNetwork(lab.document, networkId));
}
