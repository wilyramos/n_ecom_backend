// File: backend/src/modules/seo/seo.service.ts

import Product from '../../models/Product';
import Category from '../../models/Category';
import Brand from '../../models/Brand';
import Line from '../../models/ProductLine';

export type CatalogPathType =
    | 'category'
    | 'brand'
    | 'category-brand'
    | 'category-line'
    | 'category-brand-line';

export interface CatalogPathEntry {
    /** Ruta del catálogo en orden canónico: /catalogo/{categoria}/{marca}/{linea} */
    path: string;
    type: CatalogPathType;
    productCount: number;
    /** Fecha de actualización más reciente entre los productos de la combinación (ISO) */
    lastModified: string;
}

/** Mínimo de productos activos para publicar una combinación en el sitemap. */
const MIN_PRODUCTS = 1;

type Parts = { category?: string; brand?: string; line?: string };

type Bucket = {
    parts: Parts;
    count: number;
    lastModified: Date;
};

type ProductGroup = {
    _id: { categoria?: unknown; brand?: unknown; line?: unknown };
    count: number;
    lastModified?: Date;
};

const keyOf = ({ category, brand, line }: Parts) =>
    `c:${category ?? ''}|b:${brand ?? ''}|l:${line ?? ''}`;

const toId = (value: unknown): string | undefined =>
    value ? String(value) : undefined;

export class SeoService {
    /**
     * Combinaciones de catálogo (categoría / marca / línea) que tienen productos
     * activos, pensadas para el sitemap.
     *
     * - Los conteos replican el filtro de /products/catalog/resolve: productos con
     *   isActive: true y, para una categoría, ella misma más sus subcategorías
     *   directas (getCategoryFamilyIds).
     * - Se omiten las combinaciones con exactamente los mismos productos que su
     *   nivel superior (p. ej. categoría+marca cuando todos los productos de la
     *   categoría son de esa marca) o que la misma combinación con una
     *   subcategoría: serían páginas duplicadas.
     * - Se omiten slugs ambiguos: resolveContext prioriza categoría > marca > línea,
     *   así que una marca o línea cuyo slug coincida con el de otra entidad de mayor
     *   prioridad se interpretaría mal y la URL daría 404.
     * - Se omiten categorías, marcas y líneas desactivadas.
     */
    async getCatalogPaths(): Promise<CatalogPathEntry[]> {
        const [categories, brands, lines, groups] = await Promise.all([
            Category.find().select('_id slug parent isActive').lean(),
            Brand.find().select('_id slug isActive').lean(),
            Line.find().select('_id slug isActive').lean(),
            Product.aggregate<ProductGroup>([
                { $match: { isActive: true } },
                {
                    $group: {
                        _id: { categoria: '$categoria', brand: '$brand', line: '$line' },
                        count: { $sum: 1 },
                        lastModified: { $max: '$updatedAt' },
                    },
                },
            ]),
        ]);

        const categorySlugs = new Set(categories.map((c) => c.slug).filter(Boolean));
        const brandSlugs = new Set(brands.map((b) => b.slug).filter(Boolean));

        // id -> slug publicable (solo entidades activas y con slug no ambiguo)
        const categorySlugById = new Map<string, string>();
        const categoryParentById = new Map<string, string>();
        for (const c of categories) {
            const id = String(c._id);
            if (c.parent) categoryParentById.set(id, String(c.parent));
            if (c.slug && c.isActive !== false) categorySlugById.set(id, c.slug);
        }

        const brandSlugById = new Map<string, string>();
        for (const b of brands) {
            if (b.slug && b.isActive !== false && !categorySlugs.has(b.slug)) {
                brandSlugById.set(String(b._id), b.slug);
            }
        }

        const lineSlugById = new Map<string, string>();
        for (const l of lines) {
            if (
                l.slug &&
                l.isActive !== false &&
                !categorySlugs.has(l.slug) &&
                !brandSlugs.has(l.slug)
            ) {
                lineSlugById.set(String(l._id), l.slug);
            }
        }

        // Acumulación de conteos por combinación
        const buckets = new Map<string, Bucket>();
        const add = (parts: Parts, count: number, lastModified: Date) => {
            const key = keyOf(parts);
            const bucket = buckets.get(key);
            if (bucket) {
                bucket.count += count;
                if (lastModified > bucket.lastModified) bucket.lastModified = lastModified;
            } else {
                buckets.set(key, { parts, count, lastModified });
            }
        };

        for (const group of groups) {
            const categoryId = toId(group._id.categoria);
            const brand = toId(group._id.brand);
            const line = toId(group._id.line);
            const lastModified = group.lastModified ? new Date(group.lastModified) : new Date(0);

            // Un producto aparece en su categoría y en la categoría padre directa
            const categoryIds = categoryId
                ? [categoryId, categoryParentById.get(categoryId)].filter(
                    (id): id is string => Boolean(id)
                )
                : [];

            if (brand) add({ brand }, group.count, lastModified);

            for (const category of categoryIds) {
                add({ category }, group.count, lastModified);

                if (brand) {
                    add({ category, brand }, group.count, lastModified);
                    if (line) add({ category, brand, line }, group.count, lastModified);
                } else if (line) {
                    add({ category, line }, group.count, lastModified);
                }
            }
        }

        const countOf = (parts: Parts) => buckets.get(keyOf(parts))?.count;

        // Niveles superiores contra los que se detectan duplicados
        const parentsOf = ({ category, brand, line }: Parts): Parts[] => {
            if (category && brand && line) return [{ category, brand }];
            if (category && line) return [{ category }];
            if (category && brand) return [{ category }, { brand }];
            return [];
        };

        // Una combinación con la categoría padre que tiene los mismos productos que la
        // misma combinación con una subcategoría es duplicada: se publica la subcategoría
        // (más específica). Ej.: /celulares/apple/iphone-16 = /iphone/apple/iphone-16.
        const duplicatedParentKeys = new Set<string>();
        for (const { parts, count } of buckets.values()) {
            const parentCategory = parts.category ? categoryParentById.get(parts.category) : undefined;
            if (!parentCategory) continue;

            const parentParts = { ...parts, category: parentCategory };
            if (countOf(parentParts) === count) duplicatedParentKeys.add(keyOf(parentParts));
        }

        const entries: CatalogPathEntry[] = [];

        for (const { parts, count, lastModified } of buckets.values()) {
            if (count < MIN_PRODUCTS) continue;

            const isDuplicate =
                duplicatedParentKeys.has(keyOf(parts)) ||
                parentsOf(parts).some((parent) => countOf(parent) === count);
            if (isDuplicate) continue;

            const categorySlug = parts.category ? categorySlugById.get(parts.category) : undefined;
            const brandSlug = parts.brand ? brandSlugById.get(parts.brand) : undefined;
            const lineSlug = parts.line ? lineSlugById.get(parts.line) : undefined;

            // Todas las partes de la combinación deben ser publicables
            if (parts.category && !categorySlug) continue;
            if (parts.brand && !brandSlug) continue;
            if (parts.line && !lineSlug) continue;

            const segments = [categorySlug, brandSlug, lineSlug].filter(Boolean) as string[];
            const type = [
                parts.category && 'category',
                parts.brand && 'brand',
                parts.line && 'line',
            ].filter(Boolean).join('-') as CatalogPathType;

            entries.push({
                path: `/catalogo/${segments.join('/')}`,
                type,
                productCount: count,
                lastModified: lastModified.toISOString(),
            });
        }

        return entries.sort((a, b) => a.path.localeCompare(b.path));
    }
}
