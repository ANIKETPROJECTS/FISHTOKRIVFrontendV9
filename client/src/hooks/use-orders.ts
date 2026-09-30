import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { OrderRequest, InsertOrderRequest } from "@shared/schema";
import { getActiveHubDb } from "@/lib/queryClient";

export function useOrders() {
  return useQuery({
    queryKey: [api.orders.list.path],
    queryFn: async () => {
      const res = await fetch(api.orders.list.path, { credentials: "include" });
      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json() as Promise<OrderRequest[]>;
    },
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertOrderRequest) => {
      if (data.razorpayOrderId) {
        const razorpayPaymentId = data.payments?.find(
          (payment) => payment.mode === "upi" && payment.reference,
        )?.reference;
        if (!razorpayPaymentId) {
          throw new Error("Razorpay payment reference is missing");
        }
        let lastError = "Failed to finalize Razorpay payment";
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const finalizeRes = await fetch("/api/razorpay/finalize-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpayOrderId: data.razorpayOrderId,
                razorpayPaymentId,
              }),
            });
            if (finalizeRes.ok) {
              return await finalizeRes.json() as OrderRequest;
            }
            const error = await finalizeRes.json().catch(() => ({}));
            lastError = error.message || lastError;
            if (finalizeRes.status < 500) break;
          } catch (error: any) {
            lastError = error?.message || lastError;
          }
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          }
        }
        throw new Error(lastError);
      }

      const hubDbName = getActiveHubDb();
      const res = await fetch(api.orders.create.path, {
        method: api.orders.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, hubDbName }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create order");
      }
      return res.json() as Promise<OrderRequest>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/coupons/user-usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/me/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeslots"] });
    },
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const url = buildUrl(api.orders.updateStatus.path, { id });
      const res = await fetch(url, {
        method: api.orders.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json() as Promise<OrderRequest>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.orders.list.path] }),
  });
}
