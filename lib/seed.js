// Starter catalogue, used until the first change is saved in the admin.
// Prices and stock are placeholders — edit them in Admin → Products.

const sizes = (labels, stock) => labels.map(l => ({ id: l.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: l, stock }));
const one = stock => [{ id: 'std', label: '', stock }];
const KIDS = ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-12Y'];
const SHOES = ['EU 24', 'EU 26', 'EU 28', 'EU 30', 'EU 32', 'EU 34'];

export function seedCatalog() {
  const now = Date.now();
  const p = (id, name, category, price, extra = {}) => ({
    id, name, category, price,
    compareAt: 0,
    description: '',
    images: [],
    variants: one(10),
    tags: [],
    featured: false,
    active: true,
    createdAt: now,
    ...extra
  });
  return {
    demo: true,
    categories: [
      { id: 'bags', name: 'Backpacks & Bags', emoji: '🎒' },
      { id: 'lunch', name: 'Lunch & Snack', emoji: '🍱' },
      { id: 'bottles', name: 'Water Bottles', emoji: '🥤' },
      { id: 'girls', name: 'Girls', emoji: '👗' },
      { id: 'boys', name: 'Boys', emoji: '👕' },
      { id: 'shoes', name: 'Shoes', emoji: '👟' },
      { id: 'inner', name: 'Inner Wear', emoji: '🧦' }
    ],
    products: [
      p('backpack-unicorn', 'Unicorn Dream Backpack', 'bags', 25000, { compareAt: 29000, featured: true, tags: ['school'], description: 'Roomy, padded and light — fits A4 books, a snackbox and a bottle side pocket.' }),
      p('backpack-dino', 'Dino Explorer Backpack', 'bags', 25000, { featured: true, tags: ['school'], description: 'Tough water-resistant fabric with reflective strips for the school run.' }),
      p('snackbox-bento', 'Bento Snackbox', 'lunch', 14000, { tags: ['school'], description: 'Leak-proof compartments keep jollof and fruit apart. BPA free.' }),
      p('snackpack-insulated', 'Insulated Snackpack', 'lunch', 16000, { tags: ['school'], description: 'Keeps lunch cool till break time. Wipe-clean lining.' }),
      p('bottle-steel', 'Steel Water Bottle 500ml', 'bottles', 14000, { compareAt: 16000, tags: ['school'], description: 'Double-walled, keeps water cold for 12 hours. Flip straw lid.' }),
      p('dress-floral', 'Floral Party Dress', 'girls', 27000, { variants: sizes(KIDS, 4), featured: true, description: 'Soft cotton lining, twirly skirt, perfect for birthdays and Sunday best.' }),
      p('dress-denim', 'Denim Pinafore Dress', 'girls', 22000, { variants: sizes(KIDS, 4), description: 'Everyday denim with adjustable straps.' }),
      p('boys-shirt-set', 'Smart Shirt & Shorts Set', 'boys', 25000, { variants: sizes(KIDS, 4), featured: true, description: 'Breathable cotton shirt with matching shorts.' }),
      p('boys-tee-pack', 'Everyday Tee 3-Pack', 'boys', 18000, { variants: sizes(KIDS, 5), description: 'Three soft cotton tees in easy-match colours.' }),
      p('shoes-sneaker', 'Light-Up Sneakers', 'shoes', 29000, { variants: sizes(SHOES, 3), featured: true, description: 'Velcro straps for easy on/off; soles light up with every step.' }),
      p('shoes-sandals', 'Comfy Sandals', 'shoes', 18000, { variants: sizes(SHOES, 3), description: 'Cushioned footbed, adjustable buckle.' }),
      p('inner-pack', 'Cotton Inner Wear 5-Pack', 'inner', 14000, { variants: sizes(KIDS, 6), description: 'Soft, breathable cotton. Five pairs.' })
    ],
    bundles: [
      { id: 'back-to-school', name: 'Back-to-School Combo', description: 'Backpack + snackbox + bottle — everything for day one.', items: ['backpack-unicorn', 'snackbox-bento', 'bottle-steel'], type: 'percent', value: 10, active: true },
      { id: 'lunch-duo', name: 'Lunch Duo', description: 'Snackpack + bottle, sorted.', items: ['snackpack-insulated', 'bottle-steel'], type: 'fixed', value: 3000, active: true }
    ],
    promos: [
      { code: 'WELCOME10', type: 'percent', value: 10, minSubtotal: 20000, active: true }
    ],
    settings: {
      announcement: 'Nationwide delivery · Free delivery on orders over ₦60,000',
      freeDeliveryOver: 60000,
      lowStockAt: 3,
      zones: [
        { id: 'lagos', name: 'Lagos', fee: 3000 },
        { id: 'sw', name: 'South-West (outside Lagos)', fee: 4500 },
        { id: 'other', name: 'Rest of Nigeria', fee: 6000 },
        { id: 'pickup', name: 'Pick up (we’ll message you the address)', fee: 0 }
      ],
      whatsapp: '2348091111750',
      phoneDisplay: '0809 111 1750',
      instagram: 'faaskids',
      bank: { name: 'FaasKids Clothing_Accessories', bank: 'Moniepoint', number: '6655747535' }
    },
    pairs: {}
  };
}
