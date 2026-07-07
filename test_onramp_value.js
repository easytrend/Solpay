import { getOnrampValue } from 'paj_ramp';

async function test() {
  try {
    const res = await getOnrampValue({ currency: 'NGN', amount: 2000, fee: 0.1 });
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(err);
  }
}
test();
