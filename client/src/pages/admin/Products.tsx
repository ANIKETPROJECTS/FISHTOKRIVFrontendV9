import { useState } from "react";
import { useForm, useFieldArray, Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Edit2, Trash2, CheckCircle2, MoreVertical, PlusCircle, X, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { insertProductSchema } from "@shared/schema";
import type { InsertProduct, Product, Section } from "@shared/schema";
import { useProducts, useCreateProduct, useUpdateProduct, useBulkUpdateStatus, useDeleteProduct, useInventoryBatches, useAddInventoryBatch, useDeleteInventoryBatch } from "@/hooks/use-products";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const CATEGORIES = ["Fish", "Prawns", "Chicken", "Mutton", "Masalas"];
const STATUSES = ["available", "limited", "unavailable"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const PREORDER_MODES = [
  { value: "normal", label: "Normal orders only" },
  { value: "preorder_only", label: "Preorder only" },
  { value: "normal_and_preorder", label: "Normal + preorder" },
] as const;

export default function Products() {
  const { data: products } = useProducts();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [inventoryProduct, setInventoryProduct] = useState<Product | null>(null);

  const activeProducts = products?.filter(p => !p.isArchived) || [];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-display font-bold">Products</h1>
        <div className="flex items-center gap-2">
          <BulkUpdateDialog />
          <ProductDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
        </div>
      </div>

      <div className="bg-card rounded-2xl shadow-sm border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeProducts.map((p) => {
              const discount = p.originalPrice && p.price && p.originalPrice > p.price
                ? Math.round((p.originalPrice - p.price) / p.originalPrice * 100)
                : null;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                        {p.imageUrl ? <img src={p.imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-50 flex items-center justify-center">🐟</div>}
                      </div>
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{p.category}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>₹{p.price} / {p.unit}</span>
                      {p.originalPrice && p.originalPrice > (p.price ?? 0) && (
                        <span className="text-xs text-muted-foreground line-through">₹{p.originalPrice}</span>
                      )}
                      {discount && <Badge variant="secondary" className="text-xs w-fit mt-0.5 text-green-700 bg-green-50">{discount}% off</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusDropdown product={p} />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingProduct(p)}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setInventoryProduct(p)}>
                          <Layers className="w-4 h-4 mr-2" /> Inventory
                        </DropdownMenuItem>
                        <DeleteAction id={p.id} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {activeProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No products found. Add one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editingProduct && (
        <ProductDialog
          open={!!editingProduct}
          onOpenChange={(v) => !v && setEditingProduct(null)}
          product={editingProduct}
        />
      )}
      {inventoryProduct && (
        <InventoryDialog
          product={inventoryProduct}
          open={!!inventoryProduct}
          onOpenChange={(v) => !v && setInventoryProduct(null)}
        />
      )}
    </div>
  );
}

function StatusDropdown({ product }: { product: Product }) {
  const { mutate } = useUpdateProduct();
  return (
    <Select
      defaultValue={product.status}
      onValueChange={(val) => mutate({ id: product.id, status: val })}
    >
      <SelectTrigger className={`w-[130px] h-8 text-xs ${
        product.status === 'available' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
        product.status === 'limited' ? 'border-amber-200 bg-amber-50 text-amber-700' :
        'border-red-200 bg-red-50 text-red-700'
      }`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="available">Available</SelectItem>
        <SelectItem value="limited">Limited Stock</SelectItem>
        <SelectItem value="unavailable">Out of Stock</SelectItem>
      </SelectContent>
    </Select>
  );
}

function DeleteAction({ id }: { id: string }) {
  const { mutate } = useDeleteProduct();
  return (
    <DropdownMenuItem onClick={() => mutate(id)} className="text-destructive focus:bg-destructive/10">
      <Trash2 className="w-4 h-4 mr-2" /> Delete
    </DropdownMenuItem>
  );
}

function RecipeFieldEditor({ control, recipeIndex, onRemove }: {
  control: Control<InsertProduct>;
  recipeIndex: number;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const { fields: ingredientFields, append: appendIngredient, remove: removeIngredient } = useFieldArray({
    control,
    name: `recipes.${recipeIndex}.ingredients` as any,
  });

  const { fields: methodFields, append: appendMethod, remove: removeMethod } = useFieldArray({
    control,
    name: `recipes.${recipeIndex}.method` as any,
  });

  return (
    <div className="border rounded-lg bg-muted/20">
      <div className="flex items-center justify-between px-3 py-2.5 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          <span className="text-sm font-medium">Recipe {recipeIndex + 1}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField control={control} name={`recipes.${recipeIndex}.title` as any} render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel className="text-xs">Title</FormLabel>
                <FormControl><Input placeholder="e.g. Grilled Shark Curry" className="h-8 text-sm" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.description` as any} render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel className="text-xs">Description</FormLabel>
                <FormControl><Textarea placeholder="Brief recipe summary..." rows={2} className="text-sm" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.image` as any} render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel className="text-xs">Image URL</FormLabel>
                <FormControl><Input placeholder="https://..." className="h-8 text-sm" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.totalTime` as any} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Total Time</FormLabel>
                <FormControl><Input placeholder="e.g. 45 min" className="h-8 text-sm" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.prepTime` as any} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Prep Time</FormLabel>
                <FormControl><Input placeholder="e.g. 15 min" className="h-8 text-sm" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.cookTime` as any} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Cook Time</FormLabel>
                <FormControl><Input placeholder="e.g. 30 min" className="h-8 text-sm" {...field} /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.servings` as any} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Servings</FormLabel>
                <FormControl><Input type="number" min="1" className="h-8 text-sm" {...field} onChange={e => field.onChange(Number(e.target.value))} /></FormControl>
              </FormItem>
            )} />
            <FormField control={control} name={`recipes.${recipeIndex}.difficulty` as any} render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel className="text-xs">Difficulty</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{DIFFICULTIES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Ingredients</span>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => appendIngredient("" as any)}>
                <PlusCircle className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            {ingredientFields.map((f, i) => (
              <div key={f.id} className="flex gap-1.5">
                <FormField control={control} name={`recipes.${recipeIndex}.ingredients.${i}` as any} render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl><Input placeholder={`Ingredient ${i + 1}`} className="h-7 text-xs" {...field} /></FormControl>
                  </FormItem>
                )} />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeIngredient(i)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            {ingredientFields.length === 0 && <p className="text-xs text-muted-foreground">No ingredients yet.</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Method Steps</span>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => appendMethod("" as any)}>
                <PlusCircle className="w-3 h-3 mr-1" /> Add
              </Button>
            </div>
            {methodFields.map((f, i) => (
              <div key={f.id} className="flex gap-1.5 items-start">
                <span className="text-xs font-bold text-muted-foreground mt-2 w-4 shrink-0">{i + 1}.</span>
                <FormField control={control} name={`recipes.${recipeIndex}.method.${i}` as any} render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl><Textarea placeholder={`Step ${i + 1}...`} rows={2} className="text-xs" {...field} /></FormControl>
                  </FormItem>
                )} />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive mt-0.5" onClick={() => removeMethod(i)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
            {methodFields.length === 0 && <p className="text-xs text-muted-foreground">No method steps yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductDialog({ open, onOpenChange, product }: { open: boolean, onOpenChange: (v: boolean) => void, product?: Product }) {
  const { mutate: create, isPending: isCreating } = useCreateProduct();
  const { mutate: update, isPending: isUpdating } = useUpdateProduct();
  const { data: sections = [] } = useQuery<Section[]>({ queryKey: ["/api/sections"] });
  const isPending = isCreating || isUpdating;

  const productSections = sections.filter(s => s.type === "products");

  const blankRecipe = () => ({
    title: '', description: '', image: '', totalTime: '', prepTime: '',
    cookTime: '', servings: 2, difficulty: 'Medium', ingredients: [], method: [],
  });

  const form = useForm<InsertProduct>({
    resolver: zodResolver(insertProductSchema),
    values: product ? {
      name: product.name,
      category: product.category,
      subCategory: product.subCategory || '',
      price: product.price ?? 0,
      originalPrice: product.originalPrice ?? 0,
      unit: product.unit || 'per kg',
      imageUrl: product.imageUrl || '',
      status: product.status,
      limitedStockNote: product.limitedStockNote || '',
      sectionId: product.sectionId || null,
      description: product.description || '',
      grossWeight: product.grossWeight || '',
      netWeight: product.netWeight || '',
      pieces: product.pieces || '',
      serves: product.serves || '',
      quantity: product.quantity ?? 0,
      preorderMode: product.preorderMode ?? "normal",
      recipes: product.recipes?.length ? product.recipes.map(r => ({
        title: r.title,
        description: r.description,
        image: r.image || '',
        totalTime: r.totalTime || '',
        prepTime: r.prepTime || '',
        cookTime: r.cookTime || '',
        servings: r.servings ?? 2,
        difficulty: r.difficulty || 'Medium',
        ingredients: r.ingredients ?? [],
        method: r.method ?? [],
      })) : [],
    } : {
      name: '', category: 'Fish', subCategory: '', price: 0, originalPrice: 0,
      unit: 'per kg', imageUrl: '', status: 'available', limitedStockNote: '',
      sectionId: null, description: '', grossWeight: '', netWeight: '', pieces: '', serves: '',
      quantity: 0, recipes: [],
      preorderMode: "normal",
    }
  });

  const { fields: recipeFields, append: appendRecipe, remove: removeRecipe } = useFieldArray({
    control: form.control,
    name: "recipes",
  });

  const watchedPrice = form.watch("price");
  const watchedOriginalPrice = form.watch("originalPrice");
  const autoDiscount = watchedOriginalPrice && watchedPrice && watchedOriginalPrice > watchedPrice
    ? Math.round((watchedOriginalPrice - watchedPrice) / watchedOriginalPrice * 100)
    : null;

  const onSubmit = (data: InsertProduct) => {
    const payload = {
      ...data,
      sectionId: data.sectionId || null,
      originalPrice: data.originalPrice || null,
      quantity: data.quantity || null,
      recipes: data.recipes ?? [],
    };
    if (product) {
      update({ id: product.id, ...payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!product && <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> Add Product</Button></DialogTrigger>}
      <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit Product' : 'Add New Product'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2"><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem><FormLabel>Category</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem><FormLabel>Status</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></FormItem>
              )} />
              <FormField control={form.control} name="preorderMode" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Ordering availability</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "normal"}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PREORDER_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="originalPrice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Original Price (₹)</FormLabel>
                  <FormControl><Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Current Price (₹)
                    {autoDiscount && <span className="ml-2 text-xs font-normal text-green-600">{autoDiscount}% off</span>}
                  </FormLabel>
                  <FormControl><Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} /></FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="unit" render={({ field }) => (
                <FormItem><FormLabel>Unit</FormLabel><FormControl><Input placeholder="e.g. per kg" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl><Input type="number" min="0" placeholder="e.g. 50" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : null)} /></FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="subCategory" render={({ field }) => (
                <FormItem className="col-span-2"><FormLabel>Sub-Category (optional)</FormLabel><FormControl><Input placeholder="e.g. Silver Pomfret" {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="imageUrl" render={({ field }) => (
                <FormItem className="col-span-2"><FormLabel>Image URL (optional)</FormLabel><FormControl><Input placeholder="https://..." {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="col-span-2"><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Product description..." rows={3} {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="grossWeight" render={({ field }) => (
                <FormItem><FormLabel>Gross Weight <span className="text-xs font-normal text-muted-foreground">(before cleaning)</span></FormLabel><FormControl><Input placeholder="e.g. 750 g" {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="netWeight" render={({ field }) => (
                <FormItem><FormLabel>Net Weight <span className="text-xs font-normal text-muted-foreground">(delivered to customer)</span></FormLabel><FormControl><Input placeholder="e.g. 500 g" {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="pieces" render={({ field }) => (
                <FormItem><FormLabel>Pieces</FormLabel><FormControl><Input placeholder="e.g. 2–3 Pieces" {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="serves" render={({ field }) => (
                <FormItem><FormLabel>Serves</FormLabel><FormControl><Input placeholder="e.g. Serves 3" {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="sectionId" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Homepage Section</FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === "__none__" ? null : val)} value={field.value ?? "__none__"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {productSections.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              {form.watch("status") === "limited" && (
                <FormField control={form.control} name="limitedStockNote" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>Limited Stock Note</FormLabel><FormControl><Input placeholder="e.g. Only 2kg left!" {...field} value={field.value || ''} /></FormControl></FormItem>
                )} />
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Recipes</span>
                <Button type="button" variant="outline" size="sm" onClick={() => appendRecipe(blankRecipe() as any)}>
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Add Recipe
                </Button>
              </div>
              {recipeFields.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">No recipes added yet.</p>
              )}
              <div className="space-y-2">
                {recipeFields.map((_, index) => (
                  <RecipeFieldEditor
                    key={index}
                    control={form.control}
                    recipeIndex={index}
                    onRemove={() => removeRecipe(index)}
                  />
                ))}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>{isPending ? 'Saving...' : 'Save Product'}</Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function BulkUpdateDialog() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Fish");
  const [status, setStatus] = useState("unavailable");
  const { mutate, isPending } = useBulkUpdateStatus();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary" className="bg-white"><CheckCircle2 className="w-4 h-4 mr-2" /> Bulk Status</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Update Category Status</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Set Status To</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={isPending} onClick={() => mutate({ category, status }, { onSuccess: () => setOpen(false) })}>
            Apply to all {category}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InventoryDialog({ product, open, onOpenChange }: { product: Product; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: batches = [], isLoading } = useInventoryBatches(product.id);
  const { mutate: addBatch, isPending: isAdding } = useAddInventoryBatch(product.id);
  const { mutate: deleteBatch, isPending: isDeleting } = useDeleteInventoryBatch(product.id);

  const [qty, setQty] = useState("");
  const [shelfLife, setShelfLife] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const quantity = parseFloat(qty);
    const shelfLifeDays = parseFloat(shelfLife);
    if (!qty || isNaN(quantity) || quantity < 1) {
      setError("Please enter a valid quantity (min 1).");
      return;
    }
    if (!shelfLife || isNaN(shelfLifeDays) || shelfLifeDays < 0.5) {
      setError("Please enter a valid shelf life (min 0.5 days).");
      return;
    }
    setError(null);
    addBatch({ quantity, shelfLifeDays }, {
      onSuccess: () => {
        setQty("");
        setShelfLife("");
      },
      onError: (e: any) => setError(e.message),
    });
  };

  const totalQty = batches.reduce((sum, b) => sum + b.quantity, 0);

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const getExpiryDate = (entryDate: Date | string, shelfLifeDays: number) => {
    const d = new Date(entryDate);
    d.setTime(d.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000);
    return d;
  };

  const getRemainingDays = (entryDate: Date | string, shelfLifeDays: number) => {
    const expiryMs = getExpiryDate(entryDate, shelfLifeDays).getTime();
    const nowMs = Date.now();
    return (expiryMs - nowMs) / (24 * 60 * 60 * 1000);
  };

  const isExpired = (entryDate: Date | string, shelfLifeDays: number) => {
    return getRemainingDays(entryDate, shelfLifeDays) <= 0;
  };

  const formatRemaining = (remainingDays: number) => {
    if (remainingDays <= 0) {
      const ago = Math.abs(remainingDays);
      if (ago < 1) return `Expired ${Math.round(ago * 24)}h ago`;
      return `Expired ${ago.toFixed(1)}d ago`;
    }
    if (remainingDays < 1) return `${Math.round(remainingDays * 24)}h left`;
    return `${remainingDays.toFixed(1)}d left`;
  };

  const getRemainingColor = (remainingDays: number, shelfLifeDays: number) => {
    if (remainingDays <= 0) return "text-red-600 font-semibold";
    const pct = remainingDays / shelfLifeDays;
    if (pct <= 0.25) return "text-orange-600 font-semibold";
    if (pct <= 0.5) return "text-amber-600 font-medium";
    return "text-emerald-600 font-medium";
  };

  const getRemainingBarColor = (remainingDays: number, shelfLifeDays: number) => {
    if (remainingDays <= 0) return "bg-red-400";
    const pct = remainingDays / shelfLifeDays;
    if (pct <= 0.25) return "bg-orange-400";
    if (pct <= 0.5) return "bg-amber-400";
    return "bg-emerald-400";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Inventory — {product.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="bg-muted/40 rounded-xl p-4 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Stock</p>
            <p className="text-2xl font-bold">{totalQty} <span className="text-sm font-normal text-muted-foreground">units across {batches.length} batch{batches.length !== 1 ? "es" : ""}</span></p>
            <p className="text-xs text-muted-foreground">Batches are sold oldest-first (FIFO) when orders are placed.</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Add New Batch</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  min="1"
                  placeholder="Quantity"
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  data-testid="input-batch-quantity"
                />
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  placeholder="Shelf life (days)"
                  value={shelfLife}
                  onChange={e => setShelfLife(e.target.value)}
                  data-testid="input-batch-shelflife"
                />
              </div>
              <Button onClick={handleAdd} disabled={isAdding} data-testid="button-add-batch">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Current Batches <span className="text-xs font-normal text-muted-foreground">(oldest first)</span></p>
            {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {!isLoading && batches.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No inventory batches yet. Add one above.</p>
            )}
            <div className="space-y-2">
              {batches.map((batch, index) => {
                const remaining = getRemainingDays(batch.entryDate, batch.shelfLifeDays);
                const expired = remaining <= 0;
                const expiryDate = getExpiryDate(batch.entryDate, batch.shelfLifeDays);
                const barPct = expired ? 0 : Math.min(100, (remaining / batch.shelfLifeDays) * 100);
                const remainingLabel = batch.remainingTime ?? (expired ? "expired" : `${Math.floor(remaining)}d ${Math.floor((remaining % 1) * 24)}h`);
                return (
                  <div
                    key={batch.id}
                    data-testid={`card-batch-${batch.id}`}
                    className={`rounded-lg border px-4 py-3 space-y-2 ${expired ? "border-red-200 bg-red-50" : index === 0 ? "border-amber-200 bg-amber-50" : "bg-card"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{batch.quantity} units</span>
                        {index === 0 && !expired && <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 border-amber-200">Next to sell</Badge>}
                        {expired && <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 border-red-200">Expired</Badge>}
                        <span className={`text-xs ${getRemainingColor(remaining, batch.shelfLifeDays)}`}>
                          {remainingLabel === "expired" ? "expired" : `${remainingLabel} left`}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive h-7 w-7"
                        disabled={isDeleting}
                        onClick={() => deleteBatch(batch.id)}
                        data-testid={`button-delete-batch-${batch.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getRemainingBarColor(remaining, batch.shelfLifeDays)}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Added: {formatDate(batch.entryDate)}</span>
                      <span>Shelf life: {batch.shelfLifeDays}d &bull; {expired ? "Expired" : "Expires"}: {formatDate(expiryDate)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
