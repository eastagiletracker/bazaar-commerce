import PayoutPakistanProviderService from "./service";

/**
 * Registered in medusa-config against Mercur's payout module:
 *
 *   {
 *     resolve: '@mercurjs/core/modules/payout',
 *     options: {
 *       providers: [
 *         { resolve: './src/providers/payout-pakistan', id: 'pakistan', options: {...} },
 *       ],
 *     },
 *   }
 *
 * Mercur's provider loader registers the class directly (see
 * modules/payout/loaders/provider.js), so this exports the service rather than
 * wrapping it in ModuleProvider.
 */
export default {
  services: [PayoutPakistanProviderService],
};

export { PayoutPakistanProviderService };
export * from "./psp";
