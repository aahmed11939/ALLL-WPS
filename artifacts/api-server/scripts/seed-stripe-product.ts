import { getUncachableStripeClient } from "../src/stripeClient.js";

const PRODUCT_NAME = "ALLL WPS Designer — Annual";
const PRICE_AMOUNT = 499900;
const PRICE_CURRENCY = "usd";

async function main() {
  const stripe = await getUncachableStripeClient();

  const products = await stripe.products.list({ limit: 100, active: true });
  let product = products.data.find((p) => p.name === PRODUCT_NAME);

  if (product) {
    console.log(`Product already exists: ${product.id}`);
  } else {
    product = await stripe.products.create({
      name: PRODUCT_NAME,
      description: "Annual subscription to ALLL WPS Designer — Municipal Drinking-Water Pump Station Design Tool",
    });
    console.log(`Created product: ${product.id}`);
  }

  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
  });

  const existingPrice = prices.data.find(
    (p) =>
      p.unit_amount === PRICE_AMOUNT &&
      p.currency === PRICE_CURRENCY &&
      p.recurring?.interval === "year",
  );

  if (existingPrice) {
    console.log(`Price already exists: ${existingPrice.id}`);
    console.log(`\nSTRIPE_PRICE_ID=${existingPrice.id}`);
    return;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: PRICE_AMOUNT,
    currency: PRICE_CURRENCY,
    recurring: { interval: "year" },
    nickname: "Annual Plan",
  });

  console.log(`Created price: ${price.id}`);
  console.log(`\nSTRIPE_PRICE_ID=${price.id}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
