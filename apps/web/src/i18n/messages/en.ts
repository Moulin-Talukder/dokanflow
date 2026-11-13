/**
 * English UI text. Every user-visible string goes through t(key). Placeholders
 * use {name} syntax. Add a locale by creating a file that satisfies `Messages`.
 */
import { VALIDATION_MESSAGES_EN } from '@dokanflow/shared';

export const en = {
  // Keys emitted by the shared Zod schemas (validation.*).
  ...VALIDATION_MESSAGES_EN,

  'app.name': 'DokanFlow',
  'app.tagline': 'Point of sale, inventory and customer dues for small retail shops.',

  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.unexpectedError': 'Something went wrong. Please try again.',
  'common.networkError': 'Cannot reach the server. Check your connection and try again.',

  'nav.home': 'Home',
  'nav.staff': 'Staff',
  'nav.logout': 'Log out',
  'nav.shop': 'Shop',
  'nav.switchingShop': 'Switching shop…',

  'landing.login': 'Log in',
  'landing.register': 'Create a business account',
  'status.title': 'System status',
  'status.checking': 'Checking API…',
  'status.unreachable': 'API unreachable at {url}',
  'status.api': 'API',
  'status.ready': 'ready',
  'status.degraded': 'degraded',
  'status.up': 'up',
  'status.down': 'down',
  'status.database': 'PostgreSQL',
  'status.redis': 'Redis',

  'login.title': 'Log in',
  'login.identifier': 'Email or mobile number',
  'login.identifierHint': 'Owners and managers use email. Cashiers use their mobile number.',
  'login.password': 'Password',
  'login.submit': 'Log in',
  'login.invalid': 'Incorrect email, mobile number or password.',
  'login.noAccount': 'New here?',
  'login.registerLink': 'Create a business account',

  'register.title': 'Create a business account',
  'register.businessName': 'Business name',
  'register.name': 'Your name',
  'register.email': 'Email',
  'register.password': 'Password',
  'register.passwordHint': 'At least 10 characters.',
  'register.submit': 'Create account',
  'register.emailTaken': 'An account with this email already exists. Log in instead.',
  'register.haveAccount': 'Already have an account?',
  'register.loginLink': 'Log in',

  'changePassword.title': 'Change your password',
  'changePassword.required':
    'You signed in with a temporary password. Choose your own password to continue.',
  'changePassword.current': 'Current password',
  'changePassword.new': 'New password',
  'changePassword.confirm': 'Confirm new password',
  'changePassword.mismatch': 'The passwords do not match.',
  'changePassword.submit': 'Change password',
  'changePassword.done': 'Your password has been changed.',

  'home.welcome': 'Welcome, {name}',
  'home.role': 'You are signed in to {shop} as {role}.',
  'home.manageStaff': 'Manage staff',
  'home.newBusiness.title': 'Start another business',
  'home.newBusiness.hint': 'You will be its owner. Switch between shops from the menu.',
  'home.newBusiness.submit': 'Create business',
  'home.newBusiness.created': '{name} was created. Switch to it from the shop menu.',

  'role.owner': 'Owner',
  'role.manager': 'Manager',
  'role.cashier': 'Cashier',

  'staff.title': 'Staff',
  'staff.name': 'Name',
  'staff.role': 'Role',
  'staff.signIn': 'Signs in with',
  'staff.status': 'Status',
  'staff.mustChange': 'Must change password',
  'staff.active': 'Active',
  'staff.actions': 'Actions',
  'staff.empty': 'No staff yet.',
  'staff.add.title': 'Add a staff member',
  'staff.add.hint':
    'Managers sign in with email, cashiers with a mobile number. They must change the temporary password at first login.',
  'staff.add.role': 'Role',
  'staff.add.name': 'Name',
  'staff.add.email': 'Email',
  'staff.add.phone': 'Mobile number',
  'staff.add.temporaryPassword': 'Temporary password',
  'staff.add.submit': 'Add staff member',
  'staff.add.created': '{name} was added. Give them the temporary password in person.',
  'staff.add.taken': 'That email or mobile number already has an account.',
  'staff.reset.action': 'Reset password',
  'staff.reset.title': 'New temporary password for {name}',
  'staff.reset.submit': 'Reset password',
  'staff.reset.done': '{name} must sign in with the new temporary password.',
  'staff.reset.notAllowed': 'Only the person can change this password.',

  'error.forbidden': 'Your role does not allow this.',
  'error.sessionExpired': 'Your session has ended. Please log in again.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
