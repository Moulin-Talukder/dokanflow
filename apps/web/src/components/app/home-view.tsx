'use client';

import {
  type CreateTenantRequest,
  createTenantRequestSchema,
  membershipSummarySchema,
} from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { useProducts } from '@/components/catalog/use-catalog';

export function HomeView() {
  const t = useT();
  const { session, client, can } = useAuth();
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateTenantRequest>({
    resolver: zodResolver(createTenantRequestSchema),
    defaultValues: { businessName: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (!session) return null;

  const onSubmit = form.handleSubmit(async (values) => {
    setCreated(null);
    setError(null);
    try {
      const shop = await client.request('POST', '/tenants', {
        body: values,
        schema: membershipSummarySchema,
      });
      // Refresh so the new shop appears in the switcher.
      await client.refresh();
      setCreated(t('home.newBusiness.created', { name: shop.tenantName }));
      form.reset();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  });

  return (
    <div className="stack">
      <section>
        <h1>{t('home.welcome', { name: session.user.name })}</h1>
        <p className="muted">
          {t('home.role', { shop: session.tenant.name, role: t(`role.${session.role}`) })}
        </p>
        {can('staff:read') ? (
          <p>
            <Link href="/app/staff">{t('home.manageStaff')}</Link>
          </p>
        ) : null}
      </section>

      {can('stock:read') ? <LowStockAlert /> : null}

      <section className="card stack">
        <h2>{t('home.newBusiness.title')}</h2>
        <p className="muted">{t('home.newBusiness.hint')}</p>
        {created ? <FormMessage kind="success">{created}</FormMessage> : null}
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
          <Field
            id="businessName"
            label={t('register.businessName')}
            error={translateMessage(t, errors.businessName?.message)}
            {...form.register('businessName')}
          />
          <button type="submit" className="button" disabled={isSubmitting}>
            {t('home.newBusiness.submit')}
          </button>
        </form>
      </section>
    </div>
  );
}

/** Low-stock alert for the home page; hidden when nothing is low. */
function LowStockAlert() {
  const t = useT();
  const low = useProducts({ lowStock: 'true', pageSize: 1 });
  const count = low.data?.total ?? 0;
  if (count === 0) return null;
  return (
    <section className="alert stack" role="status">
      <strong>{t('home.lowStock.title')}</strong>
      <p>
        {count === 1 ? t('products.lowStockAlertOne') : t('products.lowStockAlert', { count })}{' '}
        <Link href="/app/products?lowStock=true">{t('products.viewLowStock')}</Link>
      </p>
    </section>
  );
}
