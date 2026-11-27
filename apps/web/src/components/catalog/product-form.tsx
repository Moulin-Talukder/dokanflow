'use client';

import {
  basisPointsToPercent,
  type CreateProductRequest,
  formatDisplayQuantity,
  poishaToTakaString,
  type Product,
  productUnitSchema,
} from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Field } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { type ProductFormInput, productFormSchema } from './product-form-schema';
import { useCategories } from './use-catalog';

function defaults(product: Product | undefined): ProductFormInput {
  return {
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    categoryId: product?.category?.id ?? '',
    unit: product?.unit ?? 'piece',
    price: product ? poishaToTakaString(product.pricePoisha) : '',
    cost: product ? poishaToTakaString(product.costPoisha) : '',
    vat: product?.vatRateBp != null ? basisPointsToPercent(product.vatRateBp) : '',
    threshold:
      product?.lowStockThreshold != null
        ? formatDisplayQuantity(product.lowStockThreshold, product.unit)
        : '',
  };
}

export function ProductForm({
  product,
  submitLabel,
  onSubmit,
  disabled = false,
}: {
  product?: Product;
  submitLabel: string;
  onSubmit: (values: CreateProductRequest) => Promise<void>;
  disabled?: boolean;
}) {
  const t = useT();
  const categories = useCategories();
  const form = useForm<ProductFormInput, unknown, CreateProductRequest>({
    resolver: zodResolver(productFormSchema),
    defaultValues: defaults(product),
  });
  const unit = useWatch({ control: form.control, name: 'unit' });
  const { errors, isSubmitting } = form.formState;
  const per = t(`unit.${unit}.per`);
  const field = (name: keyof ProductFormInput) => translateMessage(t, errors[name]?.message);

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit(async (values) => {
          await onSubmit(values);
        })(event)
      }
    >
      <Field
        id="product-name"
        label={t('product.form.name')}
        error={field('name')}
        {...form.register('name')}
      />
      <div className="grid-2">
        <Field
          id="product-sku"
          label={t('product.form.sku')}
          hint={t('product.form.skuHint')}
          autoCapitalize="characters"
          error={field('sku')}
          {...form.register('sku')}
        />
        <Field
          id="product-barcode"
          label={t('product.form.barcode')}
          inputMode="numeric"
          error={field('barcode')}
          {...form.register('barcode')}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="product-category">{t('product.form.category')}</label>
          <select id="product-category" {...form.register('categoryId')}>
            <option value="">{t('common.none')}</option>
            {categories.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {product?.unitLocked ? (
          // Locked: shown as text; the value still submits through the hidden input.
          <div className="field">
            <span className="label">{t('product.form.unit')}</span>
            <p className="static-value">{t(`unit.${product.unit}`)}</p>
            <input type="hidden" {...form.register('unit')} />
            <p className="hint">{t('product.form.unitLocked')}</p>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="product-unit">{t('product.form.unit')}</label>
            <select id="product-unit" {...form.register('unit')}>
              {productUnitSchema.options.map((u) => (
                <option key={u} value={u}>
                  {t(`unit.${u}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="grid-2">
        <Field
          id="product-price"
          label={t('product.form.price', { per })}
          inputMode="decimal"
          error={field('price')}
          {...form.register('price')}
        />
        <Field
          id="product-cost"
          label={t('product.form.cost', { per })}
          inputMode="decimal"
          error={field('cost')}
          {...form.register('cost')}
        />
      </div>
      <div className="grid-2">
        <Field
          id="product-vat"
          label={t('product.form.vat')}
          hint={t('product.form.vatHint')}
          inputMode="decimal"
          error={field('vat')}
          {...form.register('vat')}
        />
        <Field
          id="product-threshold"
          label={t('product.form.threshold', { unit: t(`unit.${unit}.short`) })}
          hint={t('product.form.thresholdHint')}
          inputMode="decimal"
          error={field('threshold')}
          {...form.register('threshold')}
        />
      </div>
      <button type="submit" className="button" disabled={isSubmitting || disabled}>
        {submitLabel}
      </button>
    </form>
  );
}
