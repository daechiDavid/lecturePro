# LecturePro

온라인 강의 및 발표 시 화면 위에 직접 판서할 수 있는 데스크톱 오버레이 도구입니다.

## 주요 기능

- **화면 판서** - 펜, 형광펜, 지우개로 화면 위에 자유롭게 필기
- **줌 렌즈** - 화면 특정 영역을 확대하여 표시
- **플로팅 메뉴** - 드래그 가능한 미니 컨트롤 패널
- **HUD** - 현재 모드/색상/크기를 상단에 표시
- **듀얼모니터 지원** - 플로팅 버튼이 위치한 모니터에서 전체화면 오버레이
- **커스텀 단축키** - 설정에서 모든 단축키 변경 가능
- **색상 프리셋** - 5개 색상 슬롯, 커스텀 색상 지원

## 단축키 (기본값)

| 단축키 | 기능 |
|--------|------|
| `Ctrl+Alt+A` | 오버레이 켜기/끄기 |
| `Ctrl+Alt+D` | 펜 모드 |
| `Ctrl+Alt+H` | 형광펜 모드 |
| `Ctrl+Alt+E` | 지우개 모드 |
| `Ctrl+Alt+0` | 모드 해제 |
| `Ctrl+Alt+Z` | 줌 렌즈 켜기/끄기 |
| `Ctrl+Alt+C` | 모든 필기 지우기 |
| `Ctrl+Alt+U` | 마지막 획 되돌리기 |
| `Ctrl+Alt+1~5` | 색상 1~5 선택 |
| `Ctrl+Alt+Up/Down` | 펜 굵기 증가/감소 |
| `Ctrl+Alt+Left/Right` | 줌 배율 감소/증가 |

## 설치

### Windows

[Releases](https://github.com/daechiDavid/lecturePro/releases)에서 `LecturePro Setup x.x.x.exe`를 다운로드하여 실행합니다.

### 개발 환경에서 실행

```bash
git clone https://github.com/daechiDavid/lecturePro.git
cd lecturePro
npm install
npm start
```

## 빌드

### Windows 설치파일

```bash
npm run build:win
```

`dist/LecturePro Setup x.x.x.exe` 파일이 생성됩니다.

### macOS

```bash
npm run build:mac
```

## 기술 스택

- [Electron](https://www.electronjs.org/) - 크로스 플랫폼 데스크톱 앱
- HTML5 Canvas - 판서 렌더링
- [electron-builder](https://www.electron.build/) - 패키징 및 설치파일 생성

## 라이선스

MIT
