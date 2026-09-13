import { SubHubModel } from "./adminDb";
import { getHubModels } from "./hubConnections";

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // every 1 hour

export function computeExpiryDate(entryDate: Date, shelfLifeDays: number): Date {
  return new Date(new Date(entryDate).getTime() + shelfLifeDays * 24 * 60 * 60 * 1000);
}

export function computeRemainingTime(expiryDate: Date): string {
  const msRemaining = new Date(expiryDate).getTime() - Date.now();
  if (msRemaining <= 0) return "expired";
  const totalHours = Math.floor(msRemaining / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export async function syncAllHubInventory() {
  try {
    const subHubs = await SubHubModel.find({ status: "Active" }).lean();
    let totalBatchesUpdated = 0;
    let totalCombosDeactivated = 0;

    for (const hub of subHubs as any[]) {
      if (!hub.dbName) continue;
      const { Product, Combo } = await getHubModels(hub.dbName);

      const products = await Product.find({
        "inventoryBatches.0": { $exists: true },
      }).lean();

      for (const product of products as any[]) {
        for (const batch of product.inventoryBatches ?? []) {
          const expiryDate = batch.expiryDate
            ? new Date(batch.expiryDate)
            : computeExpiryDate(batch.entryDate, batch.shelfLifeDays);

          const remainingTime = computeRemainingTime(expiryDate);

          await Product.findOneAndUpdate(
            { _id: product._id, "inventoryBatches._id": batch._id },
            {
              $set: {
                "inventoryBatches.$.expiryDate": expiryDate,
                "inventoryBatches.$.remainingTime": remainingTime,
              },
              $unset: {
                "inventoryBatches.$.remainingDays": "",
              },
            }
          );
          totalBatchesUpdated++;
        }
      }

      // Find products where every batch is expired → all-expired product IDs
      // Check both inventoryBatches (managed by this app) and batches (external admin field)
      const allBatchedProducts = await Product.find({
        $or: [
          { "inventoryBatches.0": { $exists: true } },
          { "batches.0": { $exists: true } },
        ],
      }).lean();

      const now = new Date();
      const allExpiredProductIds = (allBatchedProducts as any[])
        .filter((p: any) => {
          const invBatches: any[] = p.inventoryBatches ?? [];
          const extBatches: any[] = p.batches ?? [];
          const hasAny = invBatches.length > 0 || extBatches.length > 0;
          if (!hasAny) return false;
          const invAllExpired = invBatches.length === 0 || invBatches.every(
            (b: any) => b.remainingTime === "expired" || (b.expiryDate && new Date(b.expiryDate) <= now)
          );
          const extAllExpired = extBatches.length === 0 || extBatches.every(
            (b: any) => b.expiryDate && new Date(b.expiryDate) <= now
          );
          return invAllExpired && extAllExpired;
        })
        .map((p: any) => p._id.toString());

      // Deactivate any active combo that contains at least one all-expired product
      if (allExpiredProductIds.length > 0) {
        const result = await Combo.updateMany(
          {
            isActive: true,
            "includes.productId": { $in: allExpiredProductIds },
          },
          { $set: { isActive: false } }
        );
        totalCombosDeactivated += result.modifiedCount ?? 0;
      }
    }

    console.log(
      `[inventory sync] updated ${totalBatchesUpdated} batch(es) across ${subHubs.length} hub(s); deactivated ${totalCombosDeactivated} combo(s) due to expired products`
    );
  } catch (err) {
    console.error("[inventory sync] error:", err);
  }
}

export function startInventorySyncScheduler() {
  syncAllHubInventory();
  setInterval(syncAllHubInventory, SYNC_INTERVAL_MS);
}
