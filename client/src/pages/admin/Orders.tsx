import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";

const STATUSES = [
  { value: "pending", label: "Pending", color: "border-amber-200 bg-amber-50 text-amber-700" },
  { value: "confirmed", label: "Confirmed", color: "border-blue-200 bg-blue-50 text-blue-700" },
  { value: "out_for_delivery", label: "Out for Delivery", color: "border-purple-200 bg-purple-50 text-purple-700" },
  { value: "delivered", label: "Delivered", color: "border-emerald-200 bg-emerald-50 text-emerald-700" }
];

export default function Orders() {
  const { data: orders } = useOrders();
  const { mutate: updateStatus } = useUpdateOrderStatus();

  // Sort: pending first, then confirmed, etc. newest first within status.
  const sortedOrders = [...(orders || [])].sort((a, b) => {
    if (a.status === b.status) {
      return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
    }
    const order = { "pending": 1, "confirmed": 2, "out_for_delivery": 3, "delivered": 4 };
    return (order[a.status as keyof typeof order] || 9) - (order[b.status as keyof typeof order] || 9);
  });

  return (
    <div className="space-y-6 animate-in fade-in">
      <h1 className="text-3xl font-display font-bold">Orders</h1>

      <Card className="rounded-2xl shadow-sm border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Delivery Area</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Total</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedOrders.map((order) => {
              const items = order.items as any[];
              const total = Number(order.total ?? items.reduce((sum, item) => sum + (item.price * item.quantity), 0));
              const statusConfig = STATUSES.find(s => s.value === order.status) || STATUSES[0];
              const inventoryReviewRequired = Boolean((order as any).inventoryReviewRequired);
              const paymentStatus = String(order.paymentStatus ?? "");
              const paymentPending = paymentStatus === "pending";
              const paymentFailed = paymentStatus === "failed";
              const paymentCompleted = paymentStatus === "completed" || paymentStatus === "paid";

              return (
                <TableRow key={order.id} className="group">
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(order.createdAt!), "MMM d, h:mm a")}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.customerName}</div>
                    <div className="text-xs text-muted-foreground">{order.phone}</div>
                    {order.orderId && <div className="text-xs font-mono text-primary mt-0.5">{order.orderId}</div>}
                    {paymentPending && (
                      <div className="text-xs font-medium text-amber-700 mt-1">Awaiting UPI payment</div>
                    )}
                    {paymentFailed && (
                      <div className="text-xs font-medium text-red-700 mt-1">Payment failed</div>
                    )}
                    {paymentCompleted && (
                      <div className="text-xs font-medium text-emerald-700 mt-1">Paid online</div>
                    )}
                    {inventoryReviewRequired && (
                      <div className="text-xs font-medium text-amber-700 mt-1">
                        Inventory review required
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.deliveryArea}</div>
                    {order.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[150px]">Note: {order.notes}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm max-w-[200px]">
                      {items.map(i => `${i.quantity}x ${i.name}`).join(", ")}
                    </div>
                  </TableCell>
                  <TableCell className="font-bold">₹{total}</TableCell>
                  <TableCell className="text-right">
                    <Select 
                      defaultValue={order.status} 
                      disabled={paymentPending || paymentFailed}
                      onValueChange={(val) => updateStatus({ id: order.id, status: val })}
                    >
                      <SelectTrigger className={`w-[140px] h-8 text-xs ml-auto ${statusConfig.color}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map(s => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
            {sortedOrders.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No orders yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
