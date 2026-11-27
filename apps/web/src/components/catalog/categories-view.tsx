'use client';

import {
  type CreateCategoryRequest,
  categorySchema,
  createCategoryRequestSchema,
} from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { catalogKey, useCategories } from './use-catalog';

export function CategoriesView() {
  const t = useT();
  const queryClient = useQueryClient();
  const { client, session, can } = useAuth();
  const categories = useCategories();
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const form = useForm<CreateCategoryRequest>({
    resolver: zodResolver(createCategoryRequestSchema),
    defaultValues: { name: '' },
  });

  return (
    <div className="stack narrow-wide">
      <p>
        <Link href="/app/products">{t('common.back')}</Link>
      </p>
      <h1>{t('categories.title')}</h1>
      {categories.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : categories.isError ? (
        <FormMessage kind="error">{errorMessage(categories.error, t)}</FormMessage>
      ) : categories.data.items.length === 0 ? (
        <p className="muted">{t('categories.empty')}</p>
      ) : (
        <ul className="list">
          {categories.data.items.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
      )}
      {can('catalog:write') ? (
        <section className="card stack">
          <h2>{t('categories.add')}</h2>
          {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
          <form
            className="stack"
            noValidate
            onSubmit={(event) =>
              void form.handleSubmit(async (values) => {
                setMessage(null);
                try {
                  const created = await client.request('POST', '/categories', {
                    body: values,
                    schema: categorySchema,
                  });
                  form.reset();
                  await queryClient.invalidateQueries({ queryKey: catalogKey(session?.tenant.id) });
                  setMessage({
                    kind: 'success',
                    text: t('categories.created', { name: created.name }),
                  });
                } catch (e) {
                  setMessage({
                    kind: 'error',
                    text: errorMessage(e, t, { 409: 'categories.taken' }),
                  });
                }
              })(event)
            }
          >
            <Field
              id="category-name"
              label={t('categories.name')}
              error={translateMessage(t, form.formState.errors.name?.message)}
              {...form.register('name')}
            />
            <button type="submit" className="button" disabled={form.formState.isSubmitting}>
              {t('categories.add')}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
