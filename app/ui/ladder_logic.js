export function legs(result) {
  const c = result?.checks || {};
  
  const s1 = c.sweep ? 'pass' : 'fail';
  const s2 = s1 === 'pass' ? (c.displacement ? 'pass' : 'fail') : 'skip';
  const s3 = s2 === 'pass' ? (c.bos ? 'pass' : 'fail') : 'skip';
  const s4 = s3 === 'pass' ? (c.fvg ? 'pass' : 'fail') : 'skip';
  const s5 = s4 === 'pass' ? (c.premiumDiscount ? 'pass' : 'fail') : 'skip';

  return [
    { name: 'Sweep', note: 'Liquidity taken', state: s1 },
    { name: 'Displacement', note: 'Strong move', state: s2 },
    { name: 'BOS', note: 'Structure break', state: s3 },
    { name: 'FVG', note: 'Fair value gap', state: s4 },
    { name: 'Zone', note: 'Discount/Premium', state: s5 }
  ];
}

export function verdict(result, params) {
  const c = result?.checks || {};
  const passed = [c.sweep, c.displacement, c.bos, c.fvg, c.premiumDiscount].filter(Boolean).length;
  
  let head = '';
  let sub = '';
  let story = '';

  if (result?.signal) {
    head = 'Signal found.';
    sub = `Ready to trade.`;
    story = `All conditions met on the final bar. Target is set for ${result.signal.rewardPoints?.toFixed(2) || '...'} points.`;
  } else if (result?.armed) {
    head = 'Armed.';
    sub = `Waiting for confirmation.`;
    story = `A liquidity sweep has occurred. Waiting for displacement, market structure shift, and FVG formation within ${result.armed.barsRemaining} bars.`;
  } else {
    head = 'Waiting.';
    sub = 'No setup found.';
    story = 'Price is currently flat. Waiting for a liquidity sweep to arm the model.';
  }

  return { head, sub, story, passed };
}
