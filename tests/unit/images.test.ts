import { describe, it, expect } from 'vitest';
import {
  sniffImageMime,
  formatImageMarkdown,
  extractMarkdownImages,
  extractImagesFromContent,
  parseDataUrl,
  concatBase64,
  redactGeneratedImages,
  turnFromStoredContent,
} from '../../src/lumo-client/images.js';
import { Role } from '../../src/lumo-client/types.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('images', () => {
  it('sniffs png magic', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
  });

  it('round-trips markdown data URLs', () => {
    const md = formatImageMarkdown({ image_id: 'abc', mimeType: 'image/png', data: PNG });
    const { text, images } = extractMarkdownImages(`see this\n${md}\nok`);
    expect(text).toBe('see this\n\nok');
    expect(images).toHaveLength(1);
    expect(images[0].image_id).toBe('abc');
    expect(images[0].data).toBe(PNG);
  });

  it('parses a data URL', () => {
    expect(parseDataUrl(`data:image/png;base64,${PNG}`)).toEqual({ mimeType: 'image/png', data: PNG });
  });

  it('extracts image_url parts', async () => {
    const { text, images } = await extractImagesFromContent([
      { type: 'text', text: 'caption' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ], { maxBytes: 1024 * 1024 });
    expect(text).toBe('caption');
    expect(images[0].data).toBe(PNG);
  });

  it('concatenates base64 as raw bytes', () => {
    const a = Buffer.from('hello').toString('base64');
    const b = Buffer.from('world').toString('base64');
    expect(Buffer.from(concatBase64(a, b), 'base64').toString()).toBe('helloworld');
  });

  it('redacts data URLs for the terminal', () => {
    const md = formatImageMarkdown({ image_id: 'abc', mimeType: 'image/png', data: PNG });
    expect(redactGeneratedImages(md)).toContain('[image lumo:abc]');
    expect(redactGeneratedImages(md)).not.toContain(PNG);
  });

  it('rebuilds a turn from stored markdown content', () => {
    const md = formatImageMarkdown({ image_id: 'x1', mimeType: 'image/png', data: PNG });
    const turn = turnFromStoredContent(Role.Assistant, `done${md}`);
    expect(turn.content).toBe('done');
    expect(turn.images?.[0].image_id).toBe('x1');
  });
});
