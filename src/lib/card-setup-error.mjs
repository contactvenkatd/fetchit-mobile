// Use structured SDK codes, never render/log the raw Stripe message or object.
// A decline does not by itself identify an issuer decision versus a risk block.
export function cardSetupErrorMessage(error) {
  if (error?.code === 'Canceled') {
    return 'Card setup was canceled. Your card was not saved.';
  }
  const stripeCode = error?.stripeErrorCode ?? error?.code;
  if (stripeCode === 'card_declined') {
    if (error?.declineCode === 'invalid_account') {
      return 'This card could not be verified and was not saved. Use a different card or contact your card issuer for help.';
    }
    return 'This card was declined and was not saved. Use a different card or contact your card issuer for help.';
  }
  if (['incorrect_number', 'invalid_number', 'invalid_expiry_month', 'invalid_expiry_year',
    'expired_card', 'incorrect_cvc', 'invalid_cvc', 'incorrect_zip'].includes(stripeCode)) {
    return 'The card details could not be verified. Check the details and try again.';
  }
  if (stripeCode === 'setup_intent_authentication_failure') {
    return 'Card verification was unsuccessful. Complete your bank’s verification when saving the card.';
  }
  return 'Your card could not be saved. Please try again; if it continues, contact FetchIt support.';
}
