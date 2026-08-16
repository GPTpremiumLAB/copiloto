# Mapas offline

## Bahia

Arquivo esperado: `bahia-latest.osm.pbf`

- Fonte: OpenStreetMap, recorte diário distribuído por OpenStreetMap France.
- URL: https://download.openstreetmap.fr/extracts/south-america/brazil/northeast/bahia-latest.osm.pbf
- Formato: OSM PBF, apropriado para construir grafos de rota com Valhalla e gerar mapas vetoriais.
- Licença dos dados: Open Database License (ODbL), com atribuição obrigatória a OpenStreetMap e seus colaboradores.
- Cobertura: estado da Bahia.

Este arquivo é a fonte geográfica bruta. Ele ainda não é um mapa visual pronto nem um grafo de navegação. A próxima etapa será processá-lo para o formato do Valhalla e, separadamente, gerar blocos vetoriais para a interface offline.

Não versionar cópias adicionais do mesmo mapa. Para atualizar, substitua o arquivo por uma versão diária mais recente e registre a data e o hash em `manifest.json`.
