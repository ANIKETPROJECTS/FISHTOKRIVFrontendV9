import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Edit2, Trash2, GripVertical, ToggleLeft, ToggleRight } from "lucide-react";
import { insertSectionSchema } from "@shared/schema";
import type { InsertSection, Section } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

function useSections() {
  return useQuery<Section[]>({ queryKey: ["/api/sections"] });
}

function useCreateSection() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (data: InsertSection) => apiRequest("POST", "/api/sections", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sections"] });
      toast({ title: "Section created" });
    },
    onError: () => toast({ title: "Failed to create section", variant: "destructive" }),
  });
}

function useUpdateSection() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<InsertSection> & { id: string }) =>
      apiRequest("PATCH", `/api/sections/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sections"] });
      toast({ title: "Section updated" });
    },
    onError: () => toast({ title: "Failed to update section", variant: "destructive" }),
  });
}

function useDeleteSection() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/sections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sections"] });
      toast({ title: "Section deleted" });
    },
    onError: () => toast({ title: "Failed to delete section", variant: "destructive" }),
  });
}

export default function Sections() {
  const { data: sections = [], isLoading } = useSections();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const { mutate: deleteSection } = useDeleteSection();
  const { mutate: updateSection } = useUpdateSection();

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Sections</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage homepage sections, product groups, and preorder placement.</p>
        </div>
        <SectionDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-8 text-center">Loading sections…</div>
      ) : sections.length === 0 ? (
        <div className="bg-card rounded-2xl border p-12 text-center text-muted-foreground">
          No sections yet. Add one to start organising your homepage.
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section) => (
            <div
              key={section.id}
              className="bg-card rounded-2xl border px-5 py-4 flex items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{section.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="secondary" className="text-xs capitalize">{section.type}</Badge>
                    <span className="text-xs text-muted-foreground">Order: {section.sortOrder}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => updateSection({ id: section.id, isActive: !section.isActive })}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={section.isActive ? "Deactivate" : "Activate"}
                  data-testid={`toggle-section-${section.id}`}
                >
                  {section.isActive
                    ? <ToggleRight className="w-6 h-6 text-primary" />
                    : <ToggleLeft className="w-6 h-6" />}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditingSection(section)}
                  data-testid={`edit-section-${section.id}`}
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" data-testid={`delete-section-${section.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete section?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete "{section.title}" from the homepage. Products and their preorder settings will remain unchanged.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => deleteSection(section.id)}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingSection && (
        <SectionDialog
          open={!!editingSection}
          onOpenChange={(v) => !v && setEditingSection(null)}
          section={editingSection}
        />
      )}
    </div>
  );
}

function SectionDialog({
  open,
  onOpenChange,
  section,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  section?: Section;
}) {
  const { mutate: create, isPending: isCreating } = useCreateSection();
  const { mutate: update, isPending: isUpdating } = useUpdateSection();
  const isPending = isCreating || isUpdating;

  const form = useForm<InsertSection>({
    resolver: zodResolver(insertSectionSchema),
    values: section
      ? {
          title: section.title,
          type: section.type,
          sortOrder: section.sortOrder,
          isActive: section.isActive,
        }
      : {
          title: "",
          type: "products",
          sortOrder: 0,
          isActive: true,
        },
  });

  const onSubmit = (data: InsertSection) => {
    if (section) {
      update({ id: section.id, ...data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!section && (
        <DialogTrigger asChild>
          <Button data-testid="button-add-section">
            <Plus className="w-4 h-4 mr-2" /> Add Section
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{section ? "Edit Section" : "Add New Section"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Today's Special" {...field} data-testid="input-section-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      if (value === "preorder" && !form.getValues("title").trim()) {
                        form.setValue("title", "Preorder", { shouldDirty: true });
                      }
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-section-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="products">Products</SelectItem>
                      <SelectItem value="combos">Combos</SelectItem>
                      <SelectItem value="preorder">Preorder</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort Order</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      data-testid="input-section-sortorder"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isPending} data-testid="button-save-section">
              {isPending ? "Saving…" : "Save Section"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
