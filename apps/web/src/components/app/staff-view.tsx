'use client';

import {
  createStaffRequestSchema,
  resetStaffPasswordRequestSchema,
  type StaffMember,
  staffListResponseSchema,
  staffMemberSchema,
  staffRoleSchema,
} from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';

/**
 * Flat form fields, converted to the shared request shape: managers get an email,
 * cashiers a phone. Validation errors come back on the same field names.
 */
const addStaffFormSchema = z
  .object({
    role: staffRoleSchema,
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    temporaryPassword: z.string(),
  })
  .transform(({ role, name, email, phone, temporaryPassword }) =>
    role === 'manager'
      ? { role, name, email, temporaryPassword }
      : { role, name, phone, temporaryPassword },
  )
  .pipe(createStaffRequestSchema);

type AddStaffInput = z.input<typeof addStaffFormSchema>;
type AddStaffOutput = z.output<typeof addStaffFormSchema>;

export function StaffView() {
  const t = useT();
  const { client, session, can } = useAuth();
  const staffKey = ['staff', session?.tenant.id];
  const staff = useQuery({
    queryKey: staffKey,
    queryFn: ({ signal }) =>
      client.request('GET', '/staff', { schema: staffListResponseSchema, signal }),
  });

  return (
    <div className="stack">
      <h1>{t('staff.title')}</h1>
      {staff.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : staff.isError ? (
        <FormMessage kind="error">{errorMessage(staff.error, t)}</FormMessage>
      ) : staff.data.items.length === 0 ? (
        <p className="muted">{t('staff.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('staff.name')}</th>
                <th scope="col">{t('staff.role')}</th>
                <th scope="col">{t('staff.signIn')}</th>
                <th scope="col">{t('staff.status')}</th>
                {can('staff:reset-password') ? <th scope="col">{t('staff.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {staff.data.items.map((member) => (
                <StaffRow
                  key={member.userId}
                  member={member}
                  canReset={can('staff:reset-password')}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {can('staff:create') ? <AddStaffForm /> : null}
    </div>
  );
}

function StaffRow({ member, canReset }: { member: StaffMember; canReset: boolean }) {
  const t = useT();
  const [resetting, setResetting] = useState(false);
  const resettable = member.role !== 'owner' && member.managedByThisShop;
  return (
    <>
      <tr>
        <td>{member.name}</td>
        <td>{t(`role.${member.role}`)}</td>
        <td>{member.email ?? member.phone}</td>
        <td>{member.mustChangePassword ? t('staff.mustChange') : t('staff.active')}</td>
        {canReset ? (
          <td>
            {resettable ? (
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setResetting((v) => !v);
                }}
              >
                {t('staff.reset.action')}
              </button>
            ) : member.role !== 'owner' ? (
              <span className="muted">{t('staff.reset.notAllowed')}</span>
            ) : null}
          </td>
        ) : null}
      </tr>
      {resetting ? (
        <tr>
          <td colSpan={5}>
            <ResetPasswordForm
              member={member}
              onDone={() => {
                setResetting(false);
              }}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ResetPasswordForm({ member, onDone }: { member: StaffMember; onDone: () => void }) {
  const t = useT();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const form = useForm({
    resolver: zodResolver(resetStaffPasswordRequestSchema),
    defaultValues: { temporaryPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (temporaryPassword: string) =>
      client.request('POST', `/staff/${member.userId}/reset-password`, {
        body: { temporaryPassword },
      }),
    onSuccess: async () => {
      setMessage({ kind: 'success', text: t('staff.reset.done', { name: member.name }) });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      onDone();
    },
    onError: (e) => {
      setMessage({ kind: 'error', text: errorMessage(e, t) });
    },
  });

  return (
    <form
      className="stack inline-form"
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit((v) => {
          mutation.mutate(v.temporaryPassword);
        })(event)
      }
    >
      <Field
        id={`reset-${member.userId}`}
        type="text"
        autoComplete="off"
        label={t('staff.reset.title', { name: member.name })}
        error={translateMessage(t, form.formState.errors.temporaryPassword?.message)}
        {...form.register('temporaryPassword')}
      />
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <div className="row">
        <button type="submit" className="button" disabled={mutation.isPending}>
          {t('staff.reset.submit')}
        </button>
        <button type="button" className="button-link" onClick={onDone}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function AddStaffForm() {
  const t = useT();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const form = useForm<AddStaffInput, unknown, AddStaffOutput>({
    resolver: zodResolver(addStaffFormSchema),
    defaultValues: { role: 'cashier', name: '', email: '', phone: '', temporaryPassword: '' },
  });
  // useWatch (not form.watch) so the React Compiler can still optimise this component.
  const role = useWatch({ control: form.control, name: 'role' });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (body: AddStaffOutput) =>
      client.request('POST', '/staff', { body, schema: staffMemberSchema }),
    onSuccess: async (member) => {
      setMessage({ kind: 'success', text: t('staff.add.created', { name: member.name }) });
      form.reset({
        role: member.role === 'manager' ? 'manager' : 'cashier',
        name: '',
        email: '',
        phone: '',
        temporaryPassword: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (e) => {
      setMessage({ kind: 'error', text: errorMessage(e, t, { 409: 'staff.add.taken' }) });
    },
  });

  return (
    <section className="card stack">
      <h2>{t('staff.add.title')}</h2>
      <p className="muted">{t('staff.add.hint')}</p>
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <form
        className="stack"
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            setMessage(null);
            mutation.mutate(values);
          })(event)
        }
      >
        <div className="field">
          <label htmlFor="staff-role">{t('staff.add.role')}</label>
          <select id="staff-role" {...form.register('role')}>
            <option value="cashier">{t('role.cashier')}</option>
            <option value="manager">{t('role.manager')}</option>
          </select>
        </div>
        <Field
          id="staff-name"
          label={t('staff.add.name')}
          error={translateMessage(t, errors.name?.message)}
          {...form.register('name')}
        />
        {role === 'manager' ? (
          <Field
            id="staff-email"
            type="email"
            label={t('staff.add.email')}
            autoComplete="off"
            error={translateMessage(t, errors.email?.message)}
            {...form.register('email')}
          />
        ) : (
          <Field
            id="staff-phone"
            type="tel"
            label={t('staff.add.phone')}
            autoComplete="off"
            inputMode="tel"
            error={translateMessage(t, errors.phone?.message)}
            {...form.register('phone')}
          />
        )}
        <Field
          id="staff-password"
          type="text"
          autoComplete="off"
          label={t('staff.add.temporaryPassword')}
          hint={t('register.passwordHint')}
          error={translateMessage(t, errors.temporaryPassword?.message)}
          {...form.register('temporaryPassword')}
        />
        <button type="submit" className="button" disabled={mutation.isPending}>
          {t('staff.add.submit')}
        </button>
      </form>
    </section>
  );
}
