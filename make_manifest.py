"""Write manifest.json: a IIIF Presentation 3 manifest for the images in images/."""
import json
from pathlib import Path
from PIL import Image

BASE = 'https://dtaantwerp.github.io/iiif-test/'
SIDES = {'r': 'recto', 'v': 'verso'}

canvases = []
for path in sorted(Path('images').glob('*.jpg')):
    width, height = Image.open(path).size
    siglum, side = path.stem.split('_')
    canvas_id = f'{BASE}canvas/{path.stem}'
    service_id = f'{BASE}iiif/{path.stem}'
    canvases.append({
        'id': canvas_id,
        'type': 'Canvas',
        'label': {'en': [f'{siglum}, {SIDES[side]}']},
        'width': width,
        'height': height,
        'items': [{
            'id': f'{canvas_id}/page',
            'type': 'AnnotationPage',
            'items': [{
                'id': f'{canvas_id}/image',
                'type': 'Annotation',
                'motivation': 'painting',
                'target': canvas_id,
                'body': {
                    'id': f'{service_id}/full/max/0/default.jpg',
                    'type': 'Image',
                    'format': 'image/jpeg',
                    'width': width,
                    'height': height,
                    'service': [{'id': service_id, 'type': 'ImageService3', 'profile': 'level2'}],
                },
            }],
        }],
    })

manifest = {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    'id': f'{BASE}manifest.json',
    'type': 'Manifest',
    'label': {'en': ['The Class Tradition: the staff copies W, X and G']},
    'summary': {'en': ['Text as Data 2026-27, University of Antwerp. Three handwritten copies of a passage '
                       'from Richard de Bury, Philobiblon, ch. XVII (trans. E. C. Thomas, 1888).']},
    'items': canvases,
}
Path('manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'{len(canvases)} canvases')
