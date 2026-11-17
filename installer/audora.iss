; Installateur d'Audora pour Windows (Inno Setup 6).
; Construit par build.bat :  ISCC.exe /DAppVersion=1.3.0 installer\audora.iss
; Installe pour l'utilisateur courant (pas besoin d'etre administrateur), dans
; %LOCALAPPDATA%\Programs\Audora. Les donnees (bibliotheque, reglages) restent dans
; %LOCALAPPDATA%\Audora et ne sont jamais effacees, meme a la desinstallation.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{7E3C2A91-4F7B-4C1E-9A55-A0D0BA5E0001}
AppName=Audora
AppVersion={#AppVersion}
AppVerName=Audora {#AppVersion}
AppPublisher=Atyope
DefaultDirName={localappdata}\Programs\Audora
DefaultGroupName=Audora
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Audora-Setup-{#AppVersion}
SetupIconFile=..\icon.ico
UninstallDisplayIcon={app}\Audora.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Types]
Name: "complete"; Description: "Complète (recommandée)"
Name: "light"; Description: "Légère : Audora seul"
Name: "custom"; Description: "Personnalisée"; Flags: iscustom

[Components]
Name: "main"; Description: "Audora"; Types: complete light custom; Flags: fixed
Name: "ffmpeg"; Description: "ffmpeg : conversion en MP3, découpe des blancs, volume égalisé, vidéos HD"; Types: complete
Name: "node"; Description: "Node.js : résout les « défis » de YouTube"; Types: complete

[Messages]
SelectComponentsLabel2=Choisis ce qu'il faut installer.%n%nffmpeg est le « couteau suisse » du son. Sans lui, Audora télécharge l'audio de YouTube tel quel (en M4A, que le PC et le téléphone savent lire), mais tu perds le MP3, la découpe des blancs et des paroles, le volume égalisé et les vidéos en bonne qualité.%n%nNode.js sert uniquement à résoudre les « défis » que YouTube impose pour donner ses formats. Sans lui, Audora marche encore, mais avec des formats en moins et davantage de blocages, et ça empire à mesure que YouTube se durcit.%n%nSi ffmpeg ou Node.js sont déjà installés sur ce PC, Audora utilise ceux-là.

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"

[Files]
Source: "..\dist\Audora\*"; DestDir: "{app}"; Excludes: "\_internal\bin\*"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: main
Source: "..\dist\Audora\_internal\bin\ffmpeg.exe"; DestDir: "{app}\_internal\bin"; Flags: ignoreversion; Components: ffmpeg
Source: "..\dist\Audora\_internal\bin\ffprobe.exe"; DestDir: "{app}\_internal\bin"; Flags: ignoreversion; Components: ffmpeg
Source: "..\dist\Audora\_internal\bin\LICENCE-ffmpeg.txt"; DestDir: "{app}\_internal\bin"; Flags: ignoreversion; Components: ffmpeg
Source: "..\dist\Audora\_internal\bin\node.exe"; DestDir: "{app}\_internal\bin"; Flags: ignoreversion; Components: node
Source: "..\dist\Audora\_internal\bin\LICENCE-node.txt"; DestDir: "{app}\_internal\bin"; Flags: ignoreversion; Components: node

[InstallDelete]
; Les anciens fichiers de l'application sont remplaces en entier (jamais les donnees).
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{group}\Audora"; Filename: "{app}\Audora.exe"; AppUserModelID: "Audora.MusicPlayer"
Name: "{userdesktop}\Audora"; Filename: "{app}\Audora.exe"; AppUserModelID: "Audora.MusicPlayer"; Tasks: desktopicon

[Run]
Filename: "{app}\Audora.exe"; Description: "Lancer Audora"; Flags: nowait postinstall

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c curl -s -m 3 -X POST -H ""Content-Type: application/json"" -d ""{{\""action\"":\""quit\""}"" http://127.0.0.1:47935/action"; Flags: runhidden; RunOnceId: "QuitAudora"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Registry]
; Le lancement au demarrage du PC (s'il etait active) disparait avec l'application.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Audora"; Flags: uninsdeletevalue dontcreatekey

[Code]
// Audora tourne (reduit dans la barre des taches) : on lui demande de se fermer proprement
// avant de remplacer ses fichiers. Sa file de telechargement est sauvegardee.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/c curl -s -m 3 -X POST -H "Content-Type: application/json" -d "{\"action\":\"quit\"}" http://127.0.0.1:47935/action',
       '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(2500);
  Result := '';
end;

// --- ffmpeg et Node.js deja presents sur ce PC ? ---
// Audora utilise ceux du PC s'ils sont dans le PATH (Node.js 22 ou plus recent, sinon
// yt-dlp le refuse) : inutile d'en installer une 2e copie, la case est decochee d'office.
var
  FfmpegOnPc, NodeOnPc: String;

function NodeMajor(const Path: String): Integer;
var
  Code: Integer;
  Output: TExecOutput;
  Line: String;
begin
  Result := 0;
  if ExecAndCaptureOutput(Path, '--version', '', SW_HIDE, ewWaitUntilTerminated, Code, Output)
     and (GetArrayLength(Output.StdOut) > 0) then
  begin
    Line := Trim(Output.StdOut[0]);  { "v24.14.0" }
    if (Length(Line) > 1) and (Line[1] = 'v') then
    begin
      Delete(Line, 1, 1);
      if Pos('.', Line) > 0 then
        Line := Copy(Line, 1, Pos('.', Line) - 1);
      Result := StrToIntDef(Line, 0);
    end;
  end;
end;

procedure InitializeWizard;
var
  PathList: String;
begin
  PathList := GetEnv('PATH');
  FfmpegOnPc := '';
  if (FileSearch('ffmpeg.exe', PathList) <> '') and (FileSearch('ffprobe.exe', PathList) <> '') then
    FfmpegOnPc := FileSearch('ffmpeg.exe', PathList);
  NodeOnPc := FileSearch('node.exe', PathList);
  if (NodeOnPc <> '') and (NodeMajor(NodeOnPc) < 22) then
    NodeOnPc := '';
  if FfmpegOnPc <> '' then
    WizardSelectComponents('!ffmpeg');
  if NodeOnPc <> '' then
    WizardSelectComponents('!node');
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID <> wpSelectComponents then
    Exit;
  { Ordre des composants : 0 = Audora, 1 = ffmpeg, 2 = Node.js }
  if FfmpegOnPc <> '' then
    WizardForm.ComponentsList.ItemCaption[1] := 'ffmpeg : déjà sur ce PC, inutile de le réinstaller';
  if NodeOnPc <> '' then
    WizardForm.ComponentsList.ItemCaption[2] := 'Node.js : déjà sur ce PC, inutile de le réinstaller';
  { Une case decochee d'office : ce n'est plus l'installation "Complete". }
  if (FfmpegOnPc <> '') or (NodeOnPc <> '') then
    WizardForm.TypesCombo.ItemIndex := 2;
end;
