// Read the pinned generated client's metadata without opening a store. Keep all
// generated-client access in lib/data, including this import qualification seam.
import { PrismaClient } from './generated/client.ts';
let metadata;
export async function importModelFields(model) {
  if (!metadata) {
    const client = new PrismaClient({adapter:{provider:'sqlite',adapterName:'import-metadata',
      connect() { throw new Error('import-metadata-never-connects'); }}});
    metadata = client._runtimeDataModel;
  }
  const fields = metadata?.models?.[model]?.fields;
  if (!Array.isArray(fields)) throw new Error('import.invalid');
  return Object.freeze(Object.fromEntries(fields.map(field => [field.name,
    Object.freeze({kind:field.kind,type:field.type})])));
}
