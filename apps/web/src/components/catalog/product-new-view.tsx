'use client';

import { productSchema } from '@dokanflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { ProductForm } from './product-form';
import { catalogKey } from './use-catalog';

export function ProductNewView() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { client, session, can } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!can('catalog:write')) {
    return <FormMessage kind="error">{t('error.forbidden')}</FormMessage>;
  }

  return (
    <div className="stack narrow-wide">
      <p>
        <Link href="/app/products">{t('common.back')}</Link>
      </p>
      <h1>{t('product.newTitle')}</h1>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <section className="card">
        <ProductForm
          submitLabel={t('product.form.create')}
          onSubmit={async (values) => {
            setError(null);
            try {
              const product = await client.request('POST', '/products', {
                body: values,
                schema: productSchema,
              });
              await queryClient.invalidateQueries({ queryKey: catalogKey(session?.tenant.id) });
              router.push(`/app/products/${product.id}`);
            } catch (e) {
              setError(errorMessage(e, t, { 409: 'product.form.skuTaken' }));
            }
          }}
        />
      </section>
    </div>
  );
}
