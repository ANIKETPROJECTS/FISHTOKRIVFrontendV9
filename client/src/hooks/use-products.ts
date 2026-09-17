import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Product, InsertProduct, UpdateProductRequest, InventoryBatch } from "@shared/schema";
import { getHubHeaders } from "@/lib/queryClient";

export function useProducts() {
  return useQuery({
    queryKey: [api.products.list.path],
    // Expiry is evaluated against the current time when the API maps products.
    // Keep this explicit here so a batch disappearing at its expiry time does
    // not depend on another component's query defaults.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await fetch(api.products.list.path, {
        headers: getHubHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch products");
      return res.json() as Promise<Product[]>;
    },
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertProduct) => {
      const res = await fetch(api.products.create.path, {
        method: api.products.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create");
      }
      return res.json() as Promise<Product>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.products.list.path] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & UpdateProductRequest) => {
      const url = buildUrl(api.products.update.path, { id });
      const res = await fetch(url, {
        method: api.products.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json() as Promise<Product>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.products.list.path] }),
  });
}

export function useBulkUpdateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { category: string; status: string }) => {
      const res = await fetch(api.products.bulkUpdateStatus.path, {
        method: api.products.bulkUpdateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed bulk update");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.products.list.path] }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.products.delete.path, { id });
      const res = await fetch(url, {
        method: api.products.delete.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.products.list.path] }),
  });
}

export function useInventoryBatches(productId: string | null) {
  return useQuery<InventoryBatch[]>({
    queryKey: ["/api/products", productId, "batches"],
    enabled: !!productId,
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}/batches`, {
        headers: getHubHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch batches");
      return res.json();
    },
  });
}

export function useAddInventoryBatch(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { quantity: number; shelfLifeDays: number }) => {
      const res = await fetch(`/api/products/${productId}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getHubHeaders() },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to add batch");
      }
      return res.json() as Promise<InventoryBatch>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "batches"] });
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
    },
  });
}

export function useDeleteInventoryBatch(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetch(`/api/products/${productId}/batches/${batchId}`, {
        method: "DELETE",
        headers: getHubHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete batch");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "batches"] });
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
    },
  });
}
