# Stripe Price ID — Action Required

To activate the subscription checkout, you need a **Stripe Price ID** for the
$4,999/year plan.

## Option A — You already have one

If you already have a yearly price in your Stripe Dashboard, copy its ID (it
starts with `price_`) and add it as an environment variable:

```
STRIPE_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxxxxxx
```

## Option B — Create one now

1. Open your [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Click **"Add product"**
3. Name: `ALLL WPS Designer — Annual`
4. Pricing: **Recurring**, **$4,999.00 USD**, **Yearly**
5. Click **Save product**
6. Copy the **Price ID** (shown on the product page, starts with `price_`)
7. Add it as the `STRIPE_PRICE_ID` environment variable in the Replit Secrets
   panel

## Where to add the env var

In the Replit workspace:
- Open the **Secrets** tab (lock icon in the sidebar)
- Add key: `STRIPE_PRICE_ID`
- Value: your price ID from Stripe

The api-server reads this at startup and passes it to Stripe Checkout.
