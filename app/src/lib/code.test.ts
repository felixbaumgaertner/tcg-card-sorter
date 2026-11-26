import { describe, expect, it } from 'vitest';
import { parsePrintedCode } from './code';

describe('parsePrintedCode', () => {
	// Left side: text exactly as PaddleOCR returned it for the first test photos.
	it.each([
		['SFD·221/221', 'sfd-221-221'],
		['SFD·001/221 Kudos Productions ·@2025RGI', 'sfd-001-221'],
		['RADSP3/005·EN', 'rad-sp3-005'],
		['RAD·091a/167·EN', 'rad-091a-167'],
		['VEN·088a/166·EN League Splash Team C2026RG', 'ven-088a-166'],
		['UNL·R05a', 'unl-r05a'],
		['OGN·310/298 /GemLim·02025RGI', 'ogn-310-298'],
		['OGS • 007/024', 'ogs-007-024'],
		['UNL • 229*/219', 'unl-229*-219'],
		['PR • 012/013', 'pr-012-013']
	])('%s -> %s', (text, id) => {
		expect(parsePrintedCode(text)?.id).toBe(id);
	});

	it.each(['Kudos Productions ·@2025RGI', 'DEFLECT2', 'We are what we overcome.', '', 'ASSAULT 2', 'OGN 04', 'OGN·0'])(
		'ignores "%s"',
		(text) => {
			expect(parsePrintedCode(text)).toBeNull();
		}
	);

	it('keeps the parts', () => {
		expect(parsePrintedCode('VEN·088a/166·EN')).toEqual({
			set: 'VEN',
			number: '088a',
			total: '166',
			id: 'ven-088a-166'
		});
		expect(parsePrintedCode('UNL·R05a')?.total).toBeNull();
	});
});
